using System.Text.Json;

namespace MTBIndoorBern;

internal sealed record CourseSector(string Id,string Name,double Start,double End);
internal sealed record CourseInfo(string Id,string Name,string Description,string Folder,double Length,double Ascent,double PreviewDistance,CourseSector[]? Sectors=null);
internal static class CourseCatalog
{
    public static CourseInfo[] Load()
    {
        var entries=JsonSerializer.Deserialize<CourseInfo[]>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"Scene","courses.json")),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??[];
        var available=entries.Where(c=>new[]{"route.json","world.json","aerial.jpg"}.All(file=>File.Exists(Path.Combine(Path.GetDirectoryName(RouteFile(c))!,file)))).ToArray();
        if(available.Length==0)throw new InvalidDataException("No courses are installed. Keep the Scene folder beside the executable.");
        foreach(var course in available)ValidateSectors(course.Sectors,course.Length);
        return available;
    }
    public static void ValidateSectors(CourseSector[]? sectors,double length)
    {
        if(sectors is null||sectors.Length==0)return;
        if(!double.IsFinite(length)||length<=0||sectors.Select(s=>s.Id).Distinct(StringComparer.Ordinal).Count()!=sectors.Length)
            throw new InvalidDataException("Invalid course sectors.");
        double previous=0;
        foreach(var sector in sectors)
        {
            if(string.IsNullOrWhiteSpace(sector.Id)||string.IsNullOrWhiteSpace(sector.Name)||!double.IsFinite(sector.Start)||!double.IsFinite(sector.End)||
                sector.Start<0||sector.End>length+.01||sector.End<=sector.Start||Math.Abs(sector.Start-previous)>.01)
                throw new InvalidDataException("Course sectors must cover the route in order without gaps or overlaps.");
            previous=sector.End;
        }
        if(Math.Abs(previous-length)>.01)throw new InvalidDataException("The final sector must end at the course finish.");
    }
    public static void Verify()
    {
        ValidateSectors(null,1000);ValidateSectors([],1000);
        CourseSector[] valid=[new("one","Climb",0,300),new("two","Traverse",300,700),new("three","Return",700,1000)];
        ValidateSectors(valid,1000);
        CourseSector[][] invalid=[
            [valid[0] with { Start=1 },valid[1],valid[2]],
            [valid[0],valid[1] with { Start=301 },valid[2]],
            [valid[0],valid[1] with { Start=299 },valid[2]],
            [valid[0],valid[1],valid[2] with { End=999 }],
            [valid[0],valid[1] with { Id="one" },valid[2]],
            [valid[0],valid[1] with { End=double.NaN },valid[2]],
            [valid[0],valid[1] with { Name="" },valid[2]]];
        foreach(var sectors in invalid)
        {
            bool rejected=false;try{ValidateSectors(sectors,1000);}catch(InvalidDataException){rejected=true;}
            if(!rejected)throw new Exception("Invalid sector layout was accepted.");
        }
    }
    public static string RouteFile(CourseInfo info)
    {
        var scene=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"Scene"))+Path.DirectorySeparatorChar;
        var path=Path.GetFullPath(Path.Combine(scene,info.Folder,"route.json"));
        if(!path.StartsWith(scene,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Invalid course folder.");
        return path;
    }
}
