Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference='Stop'
$script:result=[ordered]@{fixture='desktop-acceptance-20261106';startedAt=[DateTime]::UtcNow.ToString('o');clicks=0;keyEvents=0;lastKey='';text='';events=@()}
$script:output='D:/dsh-workspaces/project/desktop-acceptance-20261106.json'
function Save-Result($kind) { $script:result.events+=@{kind=$kind;at=[DateTime]::UtcNow.ToString('o')}; $script:result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:output -Encoding UTF8 }
$form=New-Object System.Windows.Forms.Form
$form.Text='DSH Remote Desktop Acceptance'
$form.Size=New-Object System.Drawing.Size(1250,850)
$form.StartPosition='CenterScreen'
$form.BackColor=[Drawing.Color]::FromArgb(245,247,250)
$form.TopMost=$true
$font=New-Object System.Drawing.Font('Segoe UI',18)
$form.Font=$font
$title=New-Object System.Windows.Forms.Label
$title.Text='DSH Remote Desktop - Live Acceptance'
$title.Location=New-Object Drawing.Point(40,35);$title.Size=New-Object Drawing.Size(1150,55)
$form.Controls.Add($title)
$clock=New-Object System.Windows.Forms.Label
$clock.Location=New-Object Drawing.Point(40,100);$clock.Size=New-Object Drawing.Size(1100,55)
$form.Controls.Add($clock)
$button=New-Object System.Windows.Forms.Button
$button.Text='Mouse test: 0';$button.Location=New-Object Drawing.Point(40,175);$button.Size=New-Object Drawing.Size(500,85)
$button.Add_Click({ $script:result.clicks++;$button.Text='Mouse test: '+$script:result.clicks;Save-Result 'button-click' })
$form.Controls.Add($button)
$label=New-Object System.Windows.Forms.Label
$label.Text='Click below, then test keyboard and Chinese text:'
$label.Location=New-Object Drawing.Point(40,295);$label.Size=New-Object Drawing.Size(1150,45)
$form.Controls.Add($label)
$editor=New-Object System.Windows.Forms.TextBox
$editor.Multiline=$true;$editor.AcceptsReturn=$true;$editor.ScrollBars='Vertical'
$editor.Location=New-Object Drawing.Point(40,355);$editor.Size=New-Object Drawing.Size(1140,340)
$editor.Add_TextChanged({ $script:result.text=$editor.Text;Save-Result 'text-changed' })
$editor.Add_KeyDown({ $script:result.keyEvents++;$script:result.lastKey=$_.KeyCode.ToString();Save-Result 'key-down' })
$form.Controls.Add($editor)
$note=New-Object System.Windows.Forms.Label
$note.Text='Dedicated test window - no private documents'
$note.Location=New-Object Drawing.Point(40,725);$note.Size=New-Object Drawing.Size(1140,45)
$form.Controls.Add($note)
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=500
$script:tick=0
$timer.Add_Tick({ $script:tick++;$clock.Text='LIVE '+[DateTime]::UtcNow.ToString('HH:mm:ss.fff')+' UTC | ticks: '+$script:tick })
$form.Add_Shown({$timer.Start();$form.Activate();Save-Result 'shown'})
$form.Add_FormClosed({$timer.Stop();Save-Result 'closed'})
[void]$form.ShowDialog()
