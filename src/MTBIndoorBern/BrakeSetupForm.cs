using System.Globalization;

namespace MTBIndoorBern;

internal sealed class BrakeSetupForm : Form
{
    private readonly Equipment equipment;
    private readonly SensorCard device;
    private readonly System.Windows.Forms.Timer refresh = new() { Interval = 100 };
    private readonly TextBox[] released = new TextBox[2], pulled = new TextBox[2];
    private readonly Label[] reading = new Label[2], health = new Label[2];
    private readonly bool[] provisional = new bool[2];
    private readonly CheckBox leftFront;
    private readonly Label feedback;
    private ulong loadedAddress;
    private bool loaded;

    public BrakeSetupForm(Equipment equipment)
    {
        this.equipment = equipment;
        Text = "Brake setup · MTB Indoor - Bern";
        BackColor = Theme.Background; ForeColor = Theme.Ink; Font = Theme.Font(11);
        ClientSize = new Size(1140, 790); MinimumSize = new Size(1080, 825);
        StartPosition = FormStartPosition.CenterParent; AutoScaleMode = AutoScaleMode.Dpi;
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, RowCount = 5 };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        root.Controls.Add(Theme.Label("Two levers. Independent braking.", 25, style: FontStyle.Bold), 0, 0);
        root.Controls.Add(Theme.Label("Connect the board, then set each released and full-pull position. Hold still for half a second before capture. Calibration is saved on this PC for this board.", 10, Theme.Muted), 0, 1);
        var columns = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, Margin = Padding.Empty };
        columns.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
        columns.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
        columns.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
        device = new SensorCard(equipment, SensorRole.Brakes, "Bluetooth brakes", "T-Beam Supreme · two encoders");
        columns.Controls.Add(device, 0, 0);
        columns.Controls.Add(Channel(0), 1, 0); columns.Controls.Add(Channel(1), 2, 0);
        root.Controls.Add(columns, 0, 2);
        leftFront = new CheckBox { Text = "Left lever = front brake   /   Right lever = rear brake", Checked = true, Dock = DockStyle.Fill, ForeColor = Theme.Ink, AccessibleName = "Left lever is front brake" };
        root.Controls.Add(leftFront, 0, 3);
        var bottom = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, Margin = Padding.Empty };
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170)); bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        feedback = Theme.Label("Browser bench calibration is separate. Capture here or enter your measured raw endpoints.", 10, Theme.Muted);
        var save = Theme.Button("Save calibration", true); save.Margin = new Padding(8, 5, 8, 5); save.Click += (_, _) => Save();
        var close = Theme.Button("Done"); close.Margin = new Padding(0, 5, 0, 5); close.Click += (_, _) => Close();
        bottom.Controls.Add(feedback, 0, 0); bottom.Controls.Add(save, 1, 0); bottom.Controls.Add(close, 2, 0);
        root.Controls.Add(bottom, 0, 4); Controls.Add(root);
        refresh.Tick += (_, _) => RefreshState();
        Shown += async (_, _) => { RefreshState(); refresh.Start(); await equipment.ScanAsync(); };
        FormClosed += (_, _) => { refresh.Stop(); refresh.Dispose(); };
    }

    private Control Channel(int index)
    {
        string name = index == 0 ? "Left" : "Right";
        var card = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Theme.Card, Padding = new Padding(16), Margin = new Padding(0, 0, index == 0 ? 14 : 0, 0), ColumnCount = 1, RowCount = 10 };
        foreach (int height in new[] { 34, 54, 70, 24, 38, 42, 24, 38, 42 }) card.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        card.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        card.Controls.Add(Theme.Label(name + " lever", 21, style: FontStyle.Bold), 0, 0);
        reading[index] = Theme.Label("— raw   /   — %", 22, Theme.Accent, FontStyle.Bold); card.Controls.Add(reading[index], 0, 1);
        health[index] = Theme.Label("Connect the board to inspect this channel.", 10, Theme.Muted); card.Controls.Add(health[index], 0, 2);
        card.Controls.Add(Theme.Label("Released · raw", 10, Theme.Muted), 0, 3);
        released[index] = new TextBox { Dock = DockStyle.Fill, Font = Theme.Font(16), AccessibleName = name + " released raw", MaxLength = 4 };
        card.Controls.Add(released[index], 0, 4);
        var release = Theme.Button("1 · Capture released"); release.Font = Theme.Font(10); release.Margin = new Padding(0, 3, 0, 3); release.Click += (_, _) => CaptureEndpoint(index, false); card.Controls.Add(release, 0, 5);
        card.Controls.Add(Theme.Label("Full pull · raw", 10, Theme.Muted), 0, 6);
        pulled[index] = new TextBox { Dock = DockStyle.Fill, Font = Theme.Font(16), AccessibleName = name + " full pull raw", MaxLength = 4 };
        card.Controls.Add(pulled[index], 0, 7);
        var pull = Theme.Button("2 · Capture full pull"); pull.Font = Theme.Font(10); pull.Margin = new Padding(0, 3, 0, 3); pull.Click += (_, _) => CaptureEndpoint(index, true); card.Controls.Add(pull, 0, 8);
        var clear = Theme.Button("Clear this lever"); clear.Dock = DockStyle.Top; clear.Font = Theme.Font(10); clear.Click += (_, _) => Clear(index); card.Controls.Add(clear, 0, 9);
        return card;
    }

    private void RefreshState()
    {
        device.RefreshState(false, 1, 12);
        var input = equipment.BrakeInput;
        if (!loaded || loadedAddress != input.DeviceAddress)
        {
            loaded = true; loadedAddress = input.DeviceAddress;
            var calibration = equipment.BrakeCalibration;
            LoadChannel(0, calibration?.Left); LoadChannel(1, calibration?.Right);
            leftFront.Checked = calibration?.LeftIsFront ?? true;
        }
        var channels = new[] { input.Left, input.Right };
        for (int i = 0; i < 2; i++)
        {
            var channel = channels[i];
            reading[i].Text = $"{channel.Raw?.ToString() ?? "—"} raw  /  {(channel.Travel.HasValue ? (channel.Travel.Value * 100).ToString("0") : "—")}%";
            health[i].Text = channel.Status + (channel.Travel.HasValue && channel.Usable && !channel.Armed ? "\nRelease the lever to arm braking." : "");
            health[i].ForeColor = channel.Healthy ? Theme.Accent : Color.FromArgb(239, 191, 108);
        }
    }

    private void LoadChannel(int index, BrakeEndpoints? endpoints)
    {
        released[index].Text = endpoints?.Released.ToString() ?? "";
        pulled[index].Text = endpoints?.Pulled.ToString() ?? "";
        provisional[index] = endpoints?.Provisional ?? false;
    }

    private BrakeEndpoints? ReadChannel(int index)
    {
        string a = released[index].Text.Trim(), b = pulled[index].Text.Trim();
        if (a.Length == 0 && b.Length == 0) return null;
        if (!int.TryParse(a, NumberStyles.None, CultureInfo.InvariantCulture, out int start) || !int.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out int end))
            throw new InvalidOperationException($"{(index == 0 ? "Left" : "Right")}: enter both raw endpoints (0–4095).");
        var channel = index == 0 ? equipment.BrakeInput.Left : equipment.BrakeInput.Right;
        return BrakeEndpoints.Create(start, end, provisional[index] || !channel.Healthy);
    }

    private void Save()
    {
        try
        {
            EnsureDisplayedBoard();
            equipment.SaveBrakeCalibration(ReadChannel(0), ReadChannel(1), leftFront.Checked);
            feedback.Text = "Calibration saved. Release both levers before resuming your ride.";
        }
        catch (Exception e) { feedback.Text = e.Message; }
    }

    private void CaptureEndpoint(int index, bool fullPull)
    {
        try
        {
            EnsureDisplayedBoard();
            var capture = equipment.CaptureBrakeEndpoint(index == 0);
            provisional[index] |= capture.Provisional;
            if (fullPull)
            {
                pulled[index].Text = capture.Raw.ToString();
                var value = ReadChannel(index);
                var old = equipment.BrakeCalibration;
                equipment.SaveBrakeCalibration(index == 0 ? value : old?.Left, index == 1 ? value : old?.Right, leftFront.Checked);
                feedback.Text = "Endpoints saved for this lever. Release it, then check the full travel.";
            }
            else
            {
                var old = equipment.BrakeCalibration;
                equipment.SaveBrakeCalibration(index == 0 ? null : old?.Left, index == 1 ? null : old?.Right, leftFront.Checked);
                released[index].Text = capture.Raw.ToString(); pulled[index].Clear(); provisional[index] = capture.Provisional;
                feedback.Text = "Released position captured. Hold a comfortable full pull, then capture position 2.";
            }
        }
        catch (Exception e) { feedback.Text = e.Message; }
    }

    private void Clear(int index)
    {
        try
        {
            EnsureDisplayedBoard();
            var old = equipment.BrakeCalibration;
            equipment.SaveBrakeCalibration(index == 0 ? null : old?.Left, index == 1 ? null : old?.Right, leftFront.Checked);
            LoadChannel(index, null); feedback.Text = "Saved endpoints cleared for this lever.";
        }
        catch (Exception e) { feedback.Text = e.Message; }
    }

    private void EnsureDisplayedBoard()
    {
        if (loaded && loadedAddress == equipment.BrakeInput.DeviceAddress) return;
        RefreshState();
        throw new InvalidOperationException("The selected board changed. Review its endpoints, then try again.");
    }
}
