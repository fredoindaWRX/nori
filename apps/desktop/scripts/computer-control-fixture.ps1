param([switch]$KeepOpen)
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
$window=[Windows.Window]::new()
$window.Title='Nori control test — synthetic'
$window.Width=400; $window.Height=180
$stack=[Windows.Controls.StackPanel]::new()
$field=[Windows.Controls.TextBox]::new()
$field.Margin=[Windows.Thickness]::new(20)
[Windows.Automation.AutomationProperties]::SetName($field,'Synthetic text')
$button=[Windows.Controls.Button]::new()
$button.Content='Verify synthetic text'
$button.Margin=[Windows.Thickness]::new(20,0,20,20)
$button.Add_Click({
  [Console]::Out.WriteLine((@{verifiedText=$field.Text} | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  if(-not $KeepOpen){$window.Close()}
})
$stack.Children.Add($field) | Out-Null
$stack.Children.Add($button) | Out-Null
$window.Content=$stack
$window.Add_Loaded({
  $handle=([Windows.Interop.WindowInteropHelper]::new($window)).Handle.ToInt64()
  [Console]::Out.WriteLine((@{windowHandle=$handle;processId=$PID} | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
})
$timer=[Windows.Threading.DispatcherTimer]::new()
$timer.Interval=[TimeSpan]::FromSeconds($(if($KeepOpen){180}else{30}))
$timer.Add_Tick({$window.Close()})
$timer.Start()
$window.ShowDialog() | Out-Null
$timer.Stop()
