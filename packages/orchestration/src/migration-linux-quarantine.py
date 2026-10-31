import json
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time

CGROUP_ROOT = '/sys/fs/cgroup'
ID = re.compile(r'^[A-Za-z0-9_.-]{1,128}$')
stop_reason = None


def fail(code):
    raise RuntimeError(code)


def identity(pid):
    try:
        with open(f'/proc/{pid}/stat', 'rb') as handle:
            raw = handle.read(65536).decode('utf8')
        return int(raw[raw.rfind(')') + 1:].strip().split()[19])
    except (OSError, ValueError, IndexError):
        return None


def parent_alive(pid, started):
    if started is None:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return identity(pid) == started


def canonical(path, directory):
    if not isinstance(path, str) or not path.startswith('/') or '\0' in path:
        fail('MIGRATION_LINUX_QUARANTINE_PATH_INVALID')
    resolved = os.path.realpath(path)
    info = os.lstat(resolved)
    if stat.S_ISLNK(info.st_mode) or (directory and not stat.S_ISDIR(info.st_mode)) or (not directory and not stat.S_ISREG(info.st_mode)):
        fail('MIGRATION_LINUX_QUARANTINE_PATH_INVALID')
    return resolved


def validate(request):
    if not isinstance(request, dict) or set(request) != {'executable', 'args', 'cwd', 'operationId', 'cgroupRoot'}:
        fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
    operation_id = request['operationId']
    if not isinstance(operation_id, str) or not ID.fullmatch(operation_id):
        fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
    args = request['args']
    if not isinstance(args, list) or len(args) > 64 or any(not isinstance(value, str) or len(value) > 8192 or '\0' in value for value in args):
        fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
    executable = canonical(request['executable'], False)
    cwd = canonical(request['cwd'], True)
    cgroup_root = canonical(request['cgroupRoot'], True)
    owner = os.lstat(cgroup_root)
    if (cgroup_root != CGROUP_ROOT and not cgroup_root.startswith(CGROUP_ROOT + '/')) or owner.st_uid != os.geteuid():
        fail('MIGRATION_LINUX_QUARANTINE_CGROUP_UNTRUSTED')
    with open('/proc/self/cgroup', 'rb') as handle:
        membership = handle.read(4096).decode('utf8').strip()
    if not membership.startswith('0::/'):
        fail('MIGRATION_LINUX_QUARANTINE_SUPERVISOR_OUTSIDE')
    supervisor = os.path.realpath(CGROUP_ROOT + membership[3:])
    if supervisor != cgroup_root and not supervisor.startswith(cgroup_root + '/'):
        fail('MIGRATION_LINUX_QUARANTINE_SUPERVISOR_OUTSIDE')
    return executable, args, cwd, operation_id, cgroup_root


def tail(handle):
    handle.flush()
    size = handle.tell()
    handle.seek(max(0, size - 16384))
    return handle.read().decode('utf8', errors='replace')


def main():
    global stop_reason
    raw = sys.stdin.buffer.readline(65537)
    if len(raw) > 65536:
        fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
    executable, args, cwd, operation_id, cgroup_root = validate(json.loads(raw))
    parent = os.getppid()
    parent_started = identity(parent)
    if not parent_alive(parent, parent_started):
        fail('MIGRATION_LINUX_QUARANTINE_PARENT_UNAVAILABLE')
    group = os.path.join(cgroup_root, 'dsh-migration-' + operation_id)
    os.mkdir(group)
    child = None
    stdout = tempfile.TemporaryFile()
    stderr = tempfile.TemporaryFile()
    reason = 'target-exited'
    tree_stopped = False
    removed = False

    def join_cgroup():
        fd = os.open(os.path.join(group, 'cgroup.procs'), os.O_WRONLY)
        try:
            os.write(fd, str(os.getpid()).encode('ascii'))
        finally:
            os.close(fd)

    def on_stop(signum, frame):
        global stop_reason
        stop_reason = 'stop-requested'

    signal.signal(signal.SIGTERM, on_stop)
    signal.signal(signal.SIGINT, on_stop)
    try:
        environment = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': cwd}
        child = subprocess.Popen([executable, *args], cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=stdout, stderr=stderr, close_fds=True, preexec_fn=join_cgroup)
        while True:
            code = child.poll()
            if code is not None:
                break
            if stop_reason is not None:
                reason = stop_reason
                break
            if not parent_alive(parent, parent_started):
                reason = 'parent-death'
                break
            time.sleep(0.05)
        with open(os.path.join(group, 'cgroup.kill'), 'w') as handle:
            handle.write('1')
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with open(os.path.join(group, 'cgroup.procs'), 'rb') as handle:
                if not handle.read().strip():
                    tree_stopped = True
                    break
            time.sleep(0.05)
        if tree_stopped:
            os.rmdir(group)
            removed = True
        return {
            'schemaVersion': 1,
            'operationId': operation_id,
            'code': child.returncode,
            'reason': reason,
            'treeStopped': tree_stopped,
            'cgroupRemoved': removed,
            'stopEvidence': 'linux-cgroup-v2-kill' if tree_stopped else None,
            'stdoutTail': tail(stdout),
            'stderrTail': tail(stderr),
        }
    finally:
        if not removed:
            try:
                with open(os.path.join(group, 'cgroup.kill'), 'w') as handle:
                    handle.write('1')
                if child is not None:
                    child.wait(timeout=10)
                with open(os.path.join(group, 'cgroup.procs'), 'rb') as handle:
                    empty = not handle.read().strip()
                if empty:
                    os.rmdir(group)
                    removed = True
            except (OSError, subprocess.TimeoutExpired):
                pass
        stdout.close()
        stderr.close()


if __name__ == '__main__':
    try:
        result = main()
        status = 0 if result['treeStopped'] else 126
    except Exception as error:
        result = {'schemaVersion': 1, 'treeStopped': False, 'error': str(error)[:256]}
        status = 126
    sys.stdout.write(json.dumps(result, separators=(',', ':')) + '\n')
    sys.stdout.flush()
    sys.exit(status)
