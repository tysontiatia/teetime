import json

# Utah golf course coordinates (lat, lng)
COORDS = {
    "Barn Golf Club (Ogden)": (41.223, -111.973),
    "Bonneville (SLC)": (40.780, -111.852),
    "Bountiful Ridge (Bountiful)": (40.867, -111.872),
    "Carbon CC (Helper)": (39.684, -110.854),
    "Canyon Hills (Nephi)": (39.710, -111.830),
    "Cedar Hills (Cedar Hills)": (40.414, -111.758),
    "Cove View (Richfield)": (38.772, -112.084),
    "Crane Field (Clinton)": (41.138, -112.058),
    "Davis Park (Kaysville)": (41.035, -111.939),
    "Eagle Mountain (Brigham City)": (41.510, -112.001),
    "Eaglewood (N. Salt Lake)": (40.852, -111.905),
    "El Monte (Ogden)": (41.223, -111.947),
    "Forest Dale (SLC)": (40.729, -111.868),
    "Glen Eagle (Syracuse)": (41.074, -112.079),
    "Glendale (SLC)": (40.714, -111.915),
    "Homestead (Midway)": (40.512, -111.473),
    "Lakeside (West Bountiful)": (40.894, -111.908),
    "Logan River (Logan)": (41.719, -111.808),
    "Meadow Brook (SLC)": (40.677, -111.889),
    "Mick Riley (Murray)": (40.659, -111.893),
    "Mountain Dell (SLC)": (40.761, -111.721),
    "Mountain View (West Jordan)": (40.599, -111.976),
    "Mt. Ogden (Ogden)": (41.198, -111.928),
    "Murray Parkway (Murray)": (40.633, -111.868),
    "Nibley Park (SLC)": (40.714, -111.870),
    "Old Mill (SLC)": (40.653, -111.832),
    "Oquirrh Hills (Tooele)": (40.535, -112.298),
    "Remuda (Farr West)": (41.200, -112.027),
    "River Oaks (Sandy)": (40.564, -111.858),
    "Riverbend (Riverton)": (40.522, -111.928),
    "Roosevelt (Roosevelt)": (40.299, -109.989),
    "Rose Park (SLC)": (40.798, -111.926),
    "Purple Sage Golf Course (WY)": (41.268, -110.950),
    "Sleepy Ridge (Orem)": (40.314, -111.714),
    "South Mountain (Draper)": (40.503, -111.864),
    "Stonebridge (West Valley City)": (40.684, -111.964),
    "Sun Hills (Layton)": (41.074, -111.938),
    "TalonsCove (Saratoga Springs)": (40.360, -111.886),
    "Thanksgiving Point (Lehi)": (40.422, -111.901),
    "The Ranches (Eagle Mtn)": (40.340, -112.000),
    "The Ridge (West Valley)": (40.653, -112.001),
    "Timpanogos Championship (Provo)": (40.260, -111.713),
    "Timpanogos Pasture (Provo)": (40.260, -111.713),
    "Valley View (Layton)": (41.041, -111.942),
}

with open("courses.json") as f:
    courses = json.load(f)

updated = 0
for c in courses:
    name = c["name"]
    if name in COORDS:
        c["lat"] = COORDS[name][0]
        c["lng"] = COORDS[name][1]
        updated += 1
    else:
        print(f"WARNING: No coords for {name}")

with open("courses.json", "w") as f:
    json.dump(courses, f, indent=2)

print(f"Updated {updated}/{len(courses)} courses with coordinates")
