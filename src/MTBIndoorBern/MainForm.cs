namespace MTBIndoorBern;

internal static class Theme
{
    public static readonly Color Background = Color.FromArgb(15, 23, 22);
    public static readonly Color Card = Color.FromArgb(26, 38, 35);
    public static readonly Color Ink = Color.FromArgb(238, 243, 229);
    public static readonly Color Muted = Color.FromArgb(160, 180, 169);
    public static readonly Color Accent = Color.FromArgb(202, 234, 138);
    public static readonly Color Border = Color.FromArgb(56, 76, 65);
    public static Font Font(float size, FontStyle style = FontStyle.Regular) => new("Barlow", size, style);
    public static Label Label(string text, float size = 11, Color? color = null, FontStyle style = FontStyle.Regular) =>
        new() { Text = text, AutoSize = false, Dock = DockStyle.Fill, ForeColor = color ?? Ink,
            Font = Font(size, style), TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0) };
    public static Button Button(string text, bool primary = false) => new()
    {
        Text = text, AutoSize = false, Height = 40, Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat,
        BackColor = primary ? Accent : Card, ForeColor = primary ? Background : Ink,
        Font = Font(11, FontStyle.Bold), Cursor = Cursors.Hand, Margin = new Padding(0)
    };
}

internal sealed class SensorCard : Panel
{
    private readonly Equipment equipment;
    private readonly SensorRole role;
    private readonly ComboBox devices;
    private readonly Button connect, disconnect, forget;
    private readonly Label status,metrics,details;
    private NearbyDevice[] current=[];
    public SensorCard(Equipment equipment,SensorRole role,string title,string subtitle)
    {
        this.equipment=equipment;this.role=role;
        Dock=DockStyle.Fill;BackColor=Theme.Card;Padding=new Padding(22);Margin=new Padding(0,0,14,0);
        var grid=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=10,Margin=Padding.Empty};
        foreach(int h in new[]{42,32,40,48,58,62,58,44,72})grid.RowStyles.Add(new RowStyle(SizeType.Absolute,h));
        grid.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        grid.Controls.Add(Theme.Label(title,23,style:FontStyle.Bold),0,0);
        grid.Controls.Add(Theme.Label(subtitle,10,Theme.Muted),0,1);
        devices=new ComboBox{Dock=DockStyle.Fill,DropDownStyle=ComboBoxStyle.DropDownList,Font=Theme.Font(10),DropDownWidth=440,BackColor=Theme.Background,ForeColor=Theme.Ink,AccessibleName=title+" · dispositiu"};
        grid.Controls.Add(devices,0,2);
        var buttons=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,Margin=new Padding(0,5,0,5)};
        buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,55));buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,45));
        connect=Theme.Button("Connecta",true);disconnect=Theme.Button("Desconnecta");disconnect.Font=Theme.Font(9);connect.Margin=new Padding(0,0,6,0);
        buttons.Controls.Add(connect);buttons.Controls.Add(disconnect);grid.Controls.Add(buttons,0,3);
        status=Theme.Label("Cercant l’equip recordat…",11,Theme.Muted);grid.Controls.Add(status,0,4);
        metrics=Theme.Label("—",29,Theme.Accent,FontStyle.Bold);grid.Controls.Add(metrics,0,5);
        details=Theme.Label("",10,Theme.Muted);grid.Controls.Add(details,0,6);
        forget=Theme.Button("Oblida aquest dispositiu");forget.Font=Theme.Font(9);grid.Controls.Add(forget,0,7);
        grid.Controls.Add(Theme.Label(role==SensorRole.Controller?"Click 2 dret: + puja marxa, B baixa. Transmissió MTB de 12 velocitats.":role==SensorRole.Trainer?"Es reconnecta automàticament. El control de càrrega només s’activa quan inicies la ruta.":"La banda ha d’estar posada per emetre pulsacions. Es recorda i es reconnecta automàticament.",10,Theme.Muted),0,8);
        Controls.Add(grid);
        connect.Click+=async(_,_)=>{if(devices.SelectedItem is NearbyDevice d)await equipment.ConnectAsync(role,d);else{equipment.ResumeSearch(role);await equipment.ScanAsync();}};
        disconnect.Click+=async(_,_)=>await equipment.DisconnectAsync(role);
        forget.Click+=async(_,_)=>await equipment.DisconnectAsync(role,true);
    }
    public void RefreshState(bool showAll,int gear)
    {
        var c=equipment.Connections[role];var saved=equipment.Saved(role);
        var candidates=equipment.Nearby.Where(d=>showAll||d.Matches(role)).ToList();
        if(saved is not null&&!candidates.Any(d=>d.Address==saved.Address))candidates.Insert(0,new(saved.Address,saved.Name,0,[],saved.ZwiftType));
        var incoming=candidates.ToArray();
        if(!devices.DroppedDown&&!current.SequenceEqual(incoming))
        {
            var previous=(devices.SelectedItem as NearbyDevice)?.Address;
            devices.BeginUpdate();devices.Items.Clear();devices.Items.AddRange(incoming.Cast<object>().ToArray());
            devices.SelectedItem=incoming.FirstOrDefault(d=>d.Address==previous)??saved?.Find(incoming)??incoming.FirstOrDefault();devices.EndUpdate();current=incoming;
        }
        var busy=equipment.Busy(role);connect.Enabled=!busy;disconnect.Enabled=!busy&&c.HasSession;forget.Enabled=!busy&&saved is not null;devices.Enabled=!busy&&!c.HasSession;
        connect.Text=c.Connected?"Reconnecta":devices.SelectedItem is null?"Cerca ara":"Connecta";
        bool fresh=c.Connected&&c.LastPacket.HasValue&&(DateTime.UtcNow-c.LastPacket.Value).TotalSeconds<8;
        status.ForeColor=c.Connected?Theme.Accent:Theme.Muted;
        status.Text=busy?"Connectant…":c.Connected?"● Connectat · recordat":equipment.Paused(role)?"Connexió pausada. Prem Connecta per reprendre.":saved is not null?"◌ Cercant el dispositiu recordat · cada 5 s":"Selecciona un dispositiu per recordar-lo.";
        if(role==SensorRole.Trainer){metrics.Text=fresh&&c.Power.HasValue?$"{c.Power} W":"— W";details.Text=(fresh&&c.Cadence.HasValue?$"{c.Cadence:0} rpm":"— rpm")+"\n"+(c.Control?.SupportsPower==true?"Control MTB disponible":c.ControlInfo);}
        else if(role==SensorRole.HeartRate){metrics.Text=fresh&&c.HeartRate.HasValue?$"{c.HeartRate} bpm":"— bpm";details.Text=c.Battery.HasValue?$"Bateria {c.Battery}%":"";}
        else{metrics.Text=$"{gear} / 12";details.Text=c.Connected?"Click dret connectat · + / B":"Desperta el Click prement un botó.";}
    }
}

internal sealed class MainForm : Form
{
    private readonly CancellationTokenSource lifetime=new();
    private readonly System.Windows.Forms.Timer refresh=new(){Interval=1000},search=new(){Interval=5000};
    private readonly Equipment equipment;
    private readonly PreferencesStore preferences;
    private readonly SensorCard[] cards;
    private readonly RidePanel circuit;
    private readonly TextBox log;
    private readonly Label scanStatus;
    private readonly Button scan;
    private readonly CheckBox showAll;
    private bool closing;
    public MainForm(string? smokeFile=null,bool smokeDemo=true)
    {
        Text="MTB Indoor - Bern";BackColor=Theme.Background;ForeColor=Theme.Ink;Font=Theme.Font(11);
        ClientSize=new Size(1440,900);MinimumSize=new Size(1100,820);StartPosition=FormStartPosition.CenterScreen;AutoScaleMode=AutoScaleMode.Dpi;KeyPreview=true;
        preferences=new PreferencesStore(Path.Combine(AppContext.BaseDirectory,"settings.json"));
        log=new TextBox{Dock=DockStyle.Fill,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,BackColor=Theme.Background,ForeColor=Theme.Muted,BorderStyle=BorderStyle.None,Font=Theme.Font(10),AccessibleName="Registre de connexions"};
        equipment=new Equipment(preferences,lifetime.Token,AddLog);
        var root=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(28,18,28,18),ColumnCount=1,RowCount=6};
        foreach(int h in new[]{32,68,42})root.RowStyles.Add(new RowStyle(SizeType.Absolute,h));root.RowStyles.Add(new RowStyle(SizeType.Percent,100));root.RowStyles.Add(new RowStyle(SizeType.Absolute,35));root.RowStyles.Add(new RowStyle(SizeType.Absolute,75));
        root.Controls.Add(Theme.Label("MTB INDOOR - BERN   /   EL TEU EQUIP",11,Theme.Accent,FontStyle.Bold),0,0);
        var heading=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2};heading.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));heading.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,220));
        heading.Controls.Add(Theme.Label("Dispositius recordats",30,style:FontStyle.Bold));scan=Theme.Button("Cerca ara",true);scan.Margin=new Padding(0,12,14,12);heading.Controls.Add(scan);root.Controls.Add(heading,0,1);
        var statusRow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2};statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,240));
        scanStatus=Theme.Label("Cerca automàtica cada 5 segons",10,Theme.Muted);showAll=new CheckBox{Text="Mostra tots els sensors",Dock=DockStyle.Fill,ForeColor=Theme.Muted,Font=Theme.Font(10)};statusRow.Controls.Add(scanStatus);statusRow.Controls.Add(showAll);root.Controls.Add(statusRow,0,2);
        cards=[new(equipment,SensorRole.Trainer,"KICKR","Potència · cadència · càrrega MTB"),new(equipment,SensorRole.Controller,"Comandaments","Zwift Click 2 dret"),new(equipment,SensorRole.HeartRate,"Pulsòmetre","Garmin HRM-Dual")];
        var grid=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3};for(int i=0;i<3;i++){grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100f/3));grid.Controls.Add(cards[i],i,0);}root.Controls.Add(grid,0,3);
        root.Controls.Add(Theme.Label("L’equip i els ajustos es desen automàticament. Desconnectar pausa la reconnexió fins que premis Connecta o tornis a obrir l’app.",10,Theme.Muted),0,4);root.Controls.Add(log,0,5);
        var shell=new TableLayoutPanel{Dock=DockStyle.Fill,RowCount=2,ColumnCount=1,Margin=Padding.Empty};shell.RowStyles.Add(new RowStyle(SizeType.Absolute,48));shell.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        var nav=new FlowLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(20,4,0,4)};
        var rideButton=Theme.Button("Circuit",true);rideButton.Dock=DockStyle.None;rideButton.Size=new Size(150,38);
        var devicesButton=Theme.Button("Dispositius");devicesButton.Dock=DockStyle.None;devicesButton.Size=new Size(150,38);devicesButton.Margin=new Padding(10,0,0,0);nav.Controls.Add(rideButton);nav.Controls.Add(devicesButton);shell.Controls.Add(nav,0,0);
        var content=new Panel{Dock=DockStyle.Fill,Margin=Padding.Empty};content.Controls.Add(root);
        circuit=new RidePanel(equipment,preferences,()=>{circuit!.Visible=false;root.Visible=true;root.BringToFront();},AddLog,smokeFile,smokeDemo);
        content.Controls.Add(circuit);circuit.BringToFront();root.Visible=false;shell.Controls.Add(content,0,1);Controls.Add(shell);
        rideButton.Click+=(_,_)=>{root.Visible=false;circuit.Visible=true;circuit.BringToFront();};
        devicesButton.Click+=async(_,_)=>{if(circuit.Ride.Running||circuit.Ride.Busy)await circuit.Ride.PauseAsync("Ruta en pausa per configurar dispositius");circuit.Visible=false;root.Visible=true;root.BringToFront();};
        equipment.BeforeTrainerChange=async()=>{if(circuit.Ride.Running||circuit.Ride.Busy)await circuit.Ride.PauseAsync("Ruta pausada per reconnectar el KICKR");};
        equipment.Connections[SensorRole.Controller].Shift+=d=>Ui(()=>circuit.Ride.Shift(d));
        equipment.Changed+=()=>Ui(RefreshEquipment);
        scan.Click+=async(_,_)=>await equipment.ScanAsync();showAll.CheckedChanged+=(_,_)=>RefreshEquipment();
        refresh.Tick+=(_,_)=>RefreshEquipment();refresh.Start();
        search.Tick+=async(_,_)=>{if(Equipment.Roles.Any(r=>!equipment.Connections[r].Connected&&!equipment.Paused(r)))await equipment.ScanAsync();};
        Shown+=async(_,_)=>{await circuit.InitializeAsync();if(smokeFile is null){search.Start();await equipment.ScanAsync();}};
        KeyDown+=async(_,e)=>{if(e.KeyCode==Keys.Escape){e.Handled=true;await circuit.Ride.PauseAsync();}else if(e.KeyCode==Keys.F11){WindowState=WindowState==FormWindowState.Maximized?FormWindowState.Normal:FormWindowState.Maximized;e.Handled=true;}};
        FormClosing+=async(_,e)=>{if(closing)return;e.Cancel=true;closing=true;search.Stop();refresh.Stop();lifetime.Cancel();Enabled=false;await circuit.ShutdownAsync();await equipment.ShutdownAsync();equipment.Dispose();Close();};
    }
    private void Ui(Action action){if(closing||IsDisposed||!IsHandleCreated)return;try{BeginInvoke(action);}catch(InvalidOperationException){}}
    private void RefreshEquipment(){if(closing)return;scanStatus.Text=equipment.ScanStatus;scan.Enabled=!equipment.Searching;scan.Text=equipment.Searching?"Cercant…":"Cerca ara";foreach(var card in cards)card.RefreshState(showAll.Checked,circuit.Ride.Gear);}
    private void AddLog(string text){if(closing)return;log.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+text+Environment.NewLine);if(log.Lines.Length>80)log.Lines=log.Lines.TakeLast(60).ToArray();log.SelectionStart=log.TextLength;log.ScrollToCaret();}
}
