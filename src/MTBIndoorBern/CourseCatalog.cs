using System.Text.Json;

namespace MTBIndoorBern;

internal sealed record CourseInfo(string Id,string Name,string Description,string Folder,double Length,double Ascent,double PreviewDistance);
internal static class CourseCatalog
{
    public static CourseInfo[] Load()
    {
        var entries=JsonSerializer.Deserialize<CourseInfo[]>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"Scene","courses.json")),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??[];
        var available=entries.Where(c=>new[]{"route.json","world.json","aerial.jpg"}.All(file=>File.Exists(Path.Combine(Path.GetDirectoryName(RouteFile(c))!,file)))).ToArray();
        if(available.Length==0)throw new InvalidDataException("No courses are installed. Keep the Scene folder beside the executable.");
        return available;
    }
    public static string RouteFile(CourseInfo info)
    {
        var scene=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"Scene"))+Path.DirectorySeparatorChar;
        var path=Path.GetFullPath(Path.Combine(scene,info.Folder,"route.json"));
        if(!path.StartsWith(scene,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Invalid course folder.");
        return path;
    }
}
