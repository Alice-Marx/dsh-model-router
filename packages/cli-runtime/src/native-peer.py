"""Linux peer credentials and process-group supervisor. No bearer tokens exist."""
import ctypes
import base64
import json
import os
import select
import signal
import socket
import struct
import subprocess
import sys
import time

LIMIT = 262144


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def identity(pid):
    with open(f"/proc/{pid}/stat", encoding="utf-8") as file:
        fields = file.read().rsplit(") ", 1)[1].split()
    if os.stat(f"/proc/{pid}").st_uid != os.getuid():
        raise RuntimeError("OWNER_MISMATCH")
    return {"start": fields[19], "parent": int(fields[1]), "group": int(fields[2]), "state": fields[0]}


def root(pid, start):
    value = identity(pid)
    if value["start"] != start or value["state"] == "Z":
        raise RuntimeError("PROCESS_REPLACED")
    return value


def descendant(pid, root_pid, start):
    root(root_pid, start)
    for _ in range(64):
        if pid == root_pid:
            root(root_pid, start)
            return
        pid = identity(pid)["parent"]
        if pid < 1:
            break
    raise RuntimeError("PEER_OUTSIDE_TREE")


def relay(conn, check_pid, check_start, ttl):
    conn.setblocking(False)
    end = time.monotonic() + ttl / 1000
    buffers = {conn.fileno(): b"", 0: b""}
    while time.monotonic() < end:
        root(check_pid, check_start)
        ready, _, _ = select.select([conn, 0], [], [], 0.2)
        for source in ready:
            fd = source if isinstance(source, int) else source.fileno()
            data = os.read(fd, 8192)
            if not data:
                return
            buffers[fd] += data
            while b"\n" in buffers[fd]:
                line, buffers[fd] = buffers[fd].split(b"\n", 1)
                if len(line) > LIMIT:
                    raise RuntimeError("FRAME_LIMIT")
                if fd == 0:
                    conn.setblocking(True)
                    conn.sendall(line + b"\n")
                    conn.setblocking(False)
                else:
                    os.write(1, line + b"\n")
            if len(buffers[fd]) > LIMIT:
                raise RuntimeError("FRAME_LIMIT")


def peer(conn):
    pid, uid, _gid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if uid != os.getuid():
        raise RuntimeError("OWNER_MISMATCH")
    return pid


def server(spec):
    path = spec["endpoint"]
    root(spec["rootPid"], spec["rootStart"])
    listener = socket.socket(socket.AF_UNIX)
    try:
        listener.bind(path)
        os.chmod(path, 0o600)
        listener.listen(4)
        listener.settimeout(spec["ttlMs"] / 1000)
        emit({"control": "listening", "pid": os.getpid(), "start": identity(os.getpid())["start"]})
        for _ in range(16):
            conn, _address = listener.accept()
            with conn:
                peer_pid = peer(conn)
                try:
                    descendant(peer_pid, spec["rootPid"], spec["rootStart"])
                except Exception:
                    emit({"control": "rejected", "code": "PEER_OUTSIDE_TREE"})
                    continue
                emit({"control": "accepted", "peerPid": peer_pid, "rootPid": spec["rootPid"], "ownerVerified": True, "treeVerified": True})
                relay(conn, spec["rootPid"], spec["rootStart"], spec["ttlMs"])
                return
        raise RuntimeError("BOOTSTRAP_ATTEMPT_LIMIT")
    finally:
        listener.close()
        if os.path.exists(path):
            os.unlink(path)


def client(spec):
    root(spec["serverPid"], spec["serverStart"])
    if os.stat(spec["endpoint"]).st_uid != os.getuid():
        raise RuntimeError("SOCKET_OWNER_MISMATCH")
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(min(spec["ttlMs"], 15000) / 1000)
        conn.connect(spec["endpoint"])
        if peer(conn) != spec["serverPid"]:
            raise RuntimeError("SERVER_MISMATCH")
        root(spec["serverPid"], spec["serverStart"])
        relay(conn, spec["serverPid"], spec["serverStart"], spec["ttlMs"])


def supervise(spec):
    parent_pid = os.getppid()
    def parent_lost(_signal, _frame):
        raise RuntimeError("HOST_LOST")
    signal.signal(signal.SIGTERM, parent_lost)
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise RuntimeError("PARENT_DEATH_SIGNAL_UNAVAILABLE")
    if os.getppid() != parent_pid:
        raise RuntimeError("HOST_LOST")
    # The launched executable is fixed by the trusted host, never by model input.
    proc = subprocess.Popen([spec["executable"], *spec["args"]], cwd=spec["cwd"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=sys.stderr, start_new_session=True)
    start = identity(proc.pid)["start"]
    emit({"control": "spawned", "pid": proc.pid, "start": start, "containment": "linux-process-group"})
    reason = "exited"
    until = time.monotonic() + spec["ttlMs"] / 1000
    buffer = b""
    observed = {proc.pid: start}
    try:
        while proc.poll() is None:
            for name in os.listdir("/proc"):
                if not name.isdigit():
                    continue
                try:
                    info = identity(int(name))
                    if info["group"] == proc.pid or info["parent"] in observed:
                        observed[int(name)] = info["start"]
                except (OSError, RuntimeError):
                    pass
            if time.monotonic() >= until:
                reason = "deadline"
                break
            readable = select.select([0, proc.stdout], [], [], 0.1)[0]
            if proc.stdout in readable:
                output = os.read(proc.stdout.fileno(), 8192)
                if output:
                    emit({"type": "cli-output", "data": base64.b64encode(output).decode("ascii")})
            if 0 not in readable:
                continue
            data = os.read(0, 8192)
            if not data:
                reason = "cancelled"
                break
            buffer += data
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                if len(line) > LIMIT:
                    raise RuntimeError("FRAME_LIMIT")
                proc.stdin.write(line + b"\n")
                proc.stdin.flush()
            if len(buffer) > LIMIT:
                raise RuntimeError("FRAME_LIMIT")
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # Also stop observed children that changed process groups, using creation identity.
        for pid, expected in observed.items():
            try:
                if identity(pid)["start"] == expected:
                    os.kill(pid, signal.SIGKILL)
            except (OSError, RuntimeError):
                pass
        code = proc.wait(timeout=5)
        output = proc.stdout.read(LIMIT)
        if output:
            emit({"type": "cli-output", "data": base64.b64encode(output).decode("ascii")})
        stopped = True
        for pid, expected in observed.items():
            try:
                info = identity(pid)
                if info["start"] == expected and info["state"] != "Z":
                    stopped = False
            except (OSError, RuntimeError):
                pass
        emit({"control": "stopped", "pid": proc.pid, "exitCode": code, "reason": reason,
              "treeStopped": stopped, "containment": "linux-process-group", "observedProcesses": len(observed)})


try:
    mode = sys.argv[1]
    if mode == "probe":
        if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
            raise RuntimeError("PLATFORM_UNSUPPORTED")
        emit({"peer": "linux-so-peercred", "supervisor": "linux-process-group", "available": True})
    else:
        # Unbuffered first read preserves all bytes after the single configuration line.
        line = b""
        while not line.endswith(b"\n"):
            part = os.read(0, 1)
            if not part or len(line) > LIMIT:
                raise RuntimeError("INVALID_CONFIG")
            line += part
        spec = json.loads(line)
        {"server": server, "client": client, "supervise": supervise}[mode](spec)
except Exception as error:
    print("NATIVE_PEER_REFUSED: " + str(error), file=sys.stderr)
    sys.exit(2)
