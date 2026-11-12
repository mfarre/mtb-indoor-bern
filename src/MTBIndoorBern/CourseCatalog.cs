using System.Text.Json;

namespace MTBIndoorBern;

internal sealed record CourseInfo(string Id,string Name,string Description,string Folder,double Length,double Ascent,double PreviewDistance);
internal static class CourseCatalog
{
    public static CourseInfo[] Load()=>JsonSerializer.Deserialize<CourseInfo[]>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"Scene","courses.json")),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??[];
    public static string RouteFile(CourseInfo info)
    {
        var scene=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"Scene"))+Path.DirectorySeparatorChar;
        var path=Path.GetFullPath(Path.Combine(scene,info.Folder,"route.json"));
        if(!path.StartsWith(scene,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Carpeta de circuit no vàlida.");
        return path;
    }
}
