using System.Text.Json;

namespace MTBIndoorBern;

internal static class SectorStartTests
{
    public static void Verify(CourseInfo info)
    {
        var course=Course.Load(CourseCatalog.RouteFile(info));
        CourseSector[] sectors=info.Sectors is { Length:>0 } ? info.Sectors :
            [new("one","First section",0,course.Length/3),new("two","Middle section",course.Length/3,course.Length*2/3),new("three","Final section",course.Length*2/3,course.Length)];
        CourseCatalog.ValidateSectors(sectors,course.Length);
        using var trainer=new SensorConnection(SensorRole.Trainer);
        using var heart=new SensorConnection(SensorRole.HeartRate);
        var ride=new RideSession(course,trainer,heart,_=>{},routeFile:CourseCatalog.RouteFile(info),sectors:sectors);
        if(ride.Distance!=0||ride.StartSector!=""||!ride.CanSelectStart)throw new Exception("Course must initially select the full route");
        if(ride.SelectStart("missing")||ride.Distance!=0)throw new Exception("Unknown sector must not change progress");
        foreach(var sector in sectors)
        {
            if(!ride.SelectStart(sector.Id)||ride.Mode!="ready"||ride.Distance!=sector.Start||ride.StartDistance!=sector.Start||ride.StartSector!=sector.Id||ride.Elapsed!=0||ride.Climbed!=0||ride.Velocity!=0||trainer.Control is not null)
                throw new Exception("Sector preview must reset progress without acquiring trainer control");
            var preview=JsonSerializer.SerializeToElement(ride.Snapshot());
            var point=course.At(sector.Start);
            if(preview.GetProperty("grade").GetDouble()!=point.Grade||preview.GetProperty("altitude").GetDouble()!=point.Alt||preview.GetProperty("sector").GetProperty("id").GetString()!=sector.Id)
                throw new Exception("Sector preview must report the actual route gradient, altitude and section");
            if(ride.Trail.Stage is { } stage && sector.Start>0)
            {
                string expected=sector.Start>=stage.End?"passed":sector.Start>=stage.Start?"running":"waiting";
                if(ride.Descent.Status!=expected||ride.Descent.Eligible||ride.Descent.Seconds!=0)
                    throw new Exception("Selected start must position the descent timer without a record");
            }
            ride.StartAsync(false).GetAwaiter().GetResult();
            if(ride.Running||ride.Distance!=sector.Start||trainer.Control is not null)throw new Exception("Sector selection must not bypass trainer readiness");
            if(ride.SelectStart("")||ride.Distance!=sector.Start)throw new Exception("Paused live sessions cannot teleport between sectors");
            ride.ResetAsync().GetAwaiter().GetResult();
            ride.StartAsync(true).GetAwaiter().GetResult();ride.Tick(.1);
            if(Math.Abs(ride.Distance-sector.Start-.62)>.00001||Math.Abs(ride.Elapsed-.1)>.00001||ride.Climbed>1||trainer.Control is not null)
                throw new Exception("Demo must start moving at the selected sector with fresh counters");
            double previous=ride.Distance;
            if(ride.SelectStart("")||ride.Distance!=previous)throw new Exception("Running sessions cannot change their starting sector");
            ride.PauseAsync().GetAwaiter().GetResult();
            if(ride.SelectStart("")||ride.Distance!=previous)throw new Exception("Paused demos retain progress until Stop/restart");
            ride.ResumeAsync().GetAwaiter().GetResult();ride.Tick(.1);
            if(Math.Abs(ride.Distance-previous-.62)>.00001)throw new Exception("Resume must continue from the paused point");
            ride.SeekDemo(0);if(ride.Distance!=0)throw new Exception("Sector demo must still support seeking across the full profile");
            ride.SeekDemo(course.Length);if(ride.Mode!="finished"||!ride.CanSelectStart)throw new Exception("Finished demo must allow a new start selection");
            ride.StartAsync(true).GetAwaiter().GetResult();
            if(ride.Distance!=sector.Start||ride.Elapsed!=0||ride.Climbed!=0)throw new Exception("Restart after finish must return to the selected sector");
            ride.ResetAsync().GetAwaiter().GetResult();
            if(ride.Distance!=sector.Start||ride.StartSector!=sector.Id||!ride.CanSelectStart)throw new Exception("Stop/restart must retain the selected starting sector");
        }
        if(!ride.SelectStart("")||ride.Distance!=0||ride.StartDistance!=0||ride.StartSector!="")throw new Exception("Whole course must clear the sector start");
        var fresh=new RideSession(course,trainer,heart,_=>{},routeFile:CourseCatalog.RouteFile(info),sectors:sectors);
        if(fresh.Distance!=0||fresh.StartSector!="")throw new Exception("A newly selected course must not inherit the old sector");
        if(ride.Trail.Stage is { } descent)
        {
            string file=Path.Combine(Path.GetTempPath(),"mtb-sector-record-"+Guid.NewGuid().ToString("N")+".json");
            try
            {
                var records=new PersonalRecords(file);var timer=new DescentTimer(ride.Trail,records);
                foreach(double start in new[]{descent.Start,(descent.Start+descent.End)/2})
                {
                    timer.ResetAt(start);
                    if(timer.Status!="running"||!timer.Partial||timer.Seconds!=0||timer.Eligible)throw new Exception("A start at or inside the gate must arm an ineligible partial timer");
                    timer.Tick(start,start+1,1,true);timer.Tick(start+1,descent.End+1,5,true);
                    if(timer.Status!="finished"||timer.Seconds<=0||timer.Eligible||timer.NewBest||records.Best(ride.Trail.RecordKey) is not null||File.Exists(file))
                        throw new Exception("Partial live timing must advance without writing a record");
                }
                foreach(double start in new[]{descent.End,descent.End+100})
                {
                    timer.ResetAt(start);timer.Tick(start,start+10,1,true);
                    if(timer.Status!="passed"||timer.Seconds!=0||timer.Eligible||timer.NewBest||File.Exists(file))throw new Exception("A start after the descent must mark it passed rather than wait at zero metres");
                }
                timer.ResetAt(descent.Start-10);timer.Tick(descent.Start-10,descent.Start+10,2,true);
                if(timer.Status!="running"||timer.Partial||!timer.Eligible||Math.Abs(timer.Seconds-1)>.000001)throw new Exception("Normal full-gate timing and record eligibility must remain intact");
            }
            finally{if(File.Exists(file))File.Delete(file);if(File.Exists(file+".tmp"))File.Delete(file+".tmp");}
        }
    }
}
