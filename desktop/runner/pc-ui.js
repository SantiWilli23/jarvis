// Scripts FIJOS de ratón y teclado (docs/CONTROL.md). Ningún dato entra en el texto del script: todo llega en JSON
// por la variable de entorno J_DATOS. Orden en cada paso: ventana delante, proceso, host (si es navegador), objetivo,
// contraseña y lista negra, y otra vez la ventana delante justo antes de enviar. Devuelven {ok, motivo, proceso, host}.

// Suelta botones del ratón y Shift/Ctrl/Alt/Win (lo usa el freno).
export const SOLTAR = "Add-Type -Namespace J -Name S -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);'; " +
  "foreach($f in 4,16,64){[J.S]::mouse_event($f,0,0,0,[UIntPtr]::Zero)}; foreach($k in 16,17,18,91,92){[J.S]::keybd_event($k,0,2,[UIntPtr]::Zero)}";

const CABEZA = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$script:proc=''; $script:hst=''
function Fin($ok,$motivo,$items){ @{ok=$ok;motivo=$motivo;proceso=$script:proc;host=$script:hst;items=$items} | ConvertTo-Json -Compress -Depth 4; exit 0 }
trap { Fin $false 'error' $null }
$d = $env:J_DATOS | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class JU {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public KI ki; public ulong pad; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, IN[] i, int size);
  public static void Letra(char c) {
    var a = new IN[2];
    for (int i = 0; i < 2; i++) { a[i].type = 1; a[i].ki.scan = c; a[i].ki.flags = (uint)(i == 0 ? 4 : 6); }
    SendInput(2, a, Marshal.SizeOf(typeof(IN)));
  }
}
'@
[void][JU]::SetProcessDPIAware()
$AE=[System.Windows.Automation.AutomationElement]
$CT=[System.Windows.Automation.ControlType]
$W=[System.Windows.Automation.TreeWalker]::ControlViewWalker
function Llano($s){ (([string]$s).Normalize([Text.NormalizationForm]::FormD) -replace '\\p{Mn}','').ToLowerInvariant() }
function Negado($s){ $t=Llano $s; foreach($p in $d.parte){ if($t.Contains($p)){return $true} }; foreach($pal in ($t -split '[^a-z0-9]+')){ if($d.palabra -contains $pal){return $true} }; return $false }
function Prohibido($s){ $t=Llano $s; foreach($p in $d.prohibidos){ if($t.Contains($p)){return $true} }; return $false }
$hwnd=[JU]::GetForegroundWindow()
if($hwnd -eq [IntPtr]::Zero){ Fin $false 'sin_ventana' $null }
$idp=[uint32]0; [void][JU]::GetWindowThreadProcessId($hwnd,[ref]$idp)
$script:proc=((Get-Process -Id $idp).ProcessName + '.exe').ToLowerInvariant()
if(Negado $script:proc){ Fin $false 'proceso_prohibido' $null }
$win=$AE::FromHandle($hwnd)
$nav = $d.navegadores -contains $script:proc
$barra=$null; $paginas=@()
if($nav){
  $cola=New-Object System.Collections.Queue; $cola.Enqueue($win); $barras=@(); $n=0
  while($cola.Count -gt 0 -and $n -lt 600){
    $x=$cola.Dequeue(); $n++
    if($x.Current.ControlType -eq $CT::Document){ $paginas+=$x; continue }
    if($x.Current.ControlType -eq $CT::Edit -and ($x.Current.ClassName -eq 'OmniboxViewViews' -or $x.Current.AutomationId -eq 'urlbar-input')){ $barras+=$x }
    $h=$W.GetFirstChild($x); while($h){ $cola.Enqueue($h); $h=$W.GetNextSibling($h) }
  }
  if($barras.Count -ne 1){ Fin $false 'host_ilegible' $null }
  $barra=$barras[0]
  $url=([string]$barra.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value).Trim()
  if(-not $url -or $url -match '\\s'){ Fin $false 'host_ilegible' $null }
  if($url -notmatch '^[a-z][a-z0-9+.-]*://'){ $url='https://'+$url }
  $u=[Uri]$url
  if(($u.Scheme -ne 'https' -and $u.Scheme -ne 'http') -or -not $u.Host.Contains('.')){ Fin $false 'host_ilegible' $null }
  $script:hst=($u.Host.ToLowerInvariant() -replace '^www\\.','')
  if(Negado $script:hst){ Fin $false 'host_prohibido' $null }
  foreach($z in $d.negados){ if($script:hst -eq $z -or $script:hst.EndsWith('.'+$z)){ Fin $false 'host_prohibido' $null } }
  if($d.tipo -ne 'host' -or $script:hst -ne $d.valor){ Fin $false 'fuera_de_objetivo' $null }
} elseif($d.tipo -ne 'app' -or $script:proc -ne $d.valor){ Fin $false 'fuera_de_objetivo' $null }
$foco=$AE::FocusedElement
if($foco -and $foco.Current.IsPassword){ Fin $false 'campo_contrasena' $null }
$raices=@($win); if($nav){ $raices=$paginas }
function Delante(){ if([JU]::GetForegroundWindow() -ne $hwnd){ Fin $false 'cambio_de_ventana' $null } }
function EnBarra($e){ $barra -and [System.Windows.Automation.Automation]::Compare($e,$barra) }
`;

const PASOS = {
  ui_leer: `$items=@()
foreach($r in $raices){ foreach($e in $r.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)){
  if($items.Count -ge 60){ break }
  $c=$e.Current; if($c.IsPassword -or -not $c.Name){ continue }
  $nombre=[string]$c.Name; if($nombre.Length -gt 80){ $nombre=$nombre.Substring(0,80) }
  $items+=@{nombre=$nombre;tipo=($c.ControlType.ProgrammaticName -replace '^ControlType\\.','')}
} }
Delante
Fin $true '' $items`,
  ui_pulsar: `$hallados=@()
$cond=New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty,[string]$d.elemento,[System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)
foreach($r in $raices){ foreach($e in $r.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)){ $hallados+=$e } }
if($hallados.Count -eq 0){ Fin $false 'elemento_no_encontrado' $null }
if($hallados.Count -gt 1){ Fin $false 'elemento_ambiguo' $null }
$el=$hallados[0]
if($el.Current.IsPassword){ Fin $false 'campo_contrasena' $null }
if(Prohibido $el.Current.Name){ Fin $false 'elemento_prohibido' $null }
$p=$null
if($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){ Delante; $p.Invoke() }
else {
  $b=$el.Current.BoundingRectangle; if($b.IsEmpty){ Fin $false 'elemento_no_visible' $null }
  $x=[int]($b.X+$b.Width/2); $y=[int]($b.Y+$b.Height/2)
  Add-Type -AssemblyName WindowsBase
  $h=$AE::FromPoint((New-Object System.Windows.Point($x,$y)))
  while($h -and -not [System.Windows.Automation.Automation]::Compare($h,$el)){ $h=$W.GetParent($h) }
  if(-not $h){ Fin $false 'elemento_tapado' $null }
  Delante
  [void][JU]::SetCursorPos($x,$y); [JU]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [JU]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
Fin $true '' $null`,
  ui_escribir: `if(-not $foco){ Fin $false 'sin_foco' $null }
if(EnBarra $foco){ Fin $false 'barra_de_direcciones' $null }
foreach($c in ([string]$d.texto).ToCharArray()){
  Delante
  $f=$AE::FocusedElement
  if(-not $f -or $f.Current.IsPassword){ Fin $false 'campo_contrasena' $null }
  # Solo en campos de texto: un espacio sobre un botón lo pulsaría.
  if($f.Current.ControlType -ne $CT::Edit -and $f.Current.ControlType -ne $CT::Document){ Fin $false 'no_es_campo' $null }
  [JU]::Letra($c)
}
Fin $true '' $null`,
  ui_tecla: `if(-not $foco){ Fin $false 'sin_foco' $null }
if(EnBarra $foco){ Fin $false 'barra_de_direcciones' $null }
$vk=@{enter=13;tab=9;esc=27;arriba=38;abajo=40;izquierda=37;derecha=39;retroceso=8}[[string]$d.tecla]
if(-not $vk){ Fin $false 'tecla_no_permitida' $null }
if($vk -eq 13 -and (Prohibido $foco.Current.Name)){ Fin $false 'elemento_prohibido' $null }
Delante
[JU]::keybd_event($vk,0,0,[UIntPtr]::Zero); [JU]::keybd_event($vk,0,2,[UIntPtr]::Zero)
Fin $true '' $null`,
};

export const UI_SCRIPTS = Object.fromEntries(Object.entries(PASOS).map(([id, paso]) => [id, CABEZA + paso]));

export const MOTIVOS = {
  sin_ventana: "no hay ninguna ventana delante", proceso_prohibido: "esa aplicación está prohibida", host_ilegible: "no pude leer la dirección del navegador",
  host_prohibido: "esa página está prohibida", fuera_de_objetivo: "la ventana de delante no es el objetivo autorizado", campo_contrasena: "hay un campo de contraseña",
  cambio_de_ventana: "cambió la ventana a mitad", elemento_no_encontrado: "no encontré ese elemento", elemento_ambiguo: "hay varios elementos con ese nombre",
  elemento_prohibido: "ese botón no se pulsa (pagos o permisos)", elemento_no_visible: "el elemento no está visible", elemento_tapado: "el elemento está tapado",
  sin_foco: "no hay ningún campo con el foco", no_es_campo: "el foco no está en un campo de texto",barra_de_direcciones: "no escribo en la barra de direcciones", tecla_no_permitida: "tecla no permitida",
};
