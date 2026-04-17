import json, subprocess

# These are the slug-based club IDs we found earlier
SLUG_MAP = {
    "Meadow Brook (SLC)": "meadow-brook-slco",
    "Mick Riley (Murray)": "mick-riley-slco",
    "Mountain View (West Jordan)": "mountain-view-slco",
    "River Oaks (Sandy)": "river-oaks-golf-course-utah",
    "Riverbend (Riverton)": "riverbend-slco",
    "South Mountain (Draper)": "south-mountain-slco",
}

with open("courses.json") as f:
    courses = json.load(f)

headers = [
    "-H", "Accept: application/json",
    "-H", "X-Requested-With: XMLHttpRequest",
    "-H", "Referer: https://www.chronogolf.com/",
]

for c in courses:
    if c.get("platform") != "chronogolf":
        continue
    name = c["name"]
    slug = SLUG_MAP.get(name)
    if not slug:
        print(f"SKIP: {name} (no slug)")
        continue

    r = subprocess.run(
        ["curl", "-s", f"https://www.chronogolf.com/marketplace/v2/clubs/{slug}"] + headers,
        capture_output=True, text=True, timeout=10,
    )
    data = json.loads(r.stdout)
    club_id = str(data.get("id", ""))
    aff = str(data.get("default_affiliation_type_id", ""))
    club_courses = data.get("courses", [])
    course_id = str(club_courses[0]["id"]) if club_courses else ""

    if club_id and course_id and aff:
        c["platform"] = "chronogolf_slc"
        c["club_id"] = club_id
        c["course_id"] = course_id
        c["affiliation_type_id"] = aff
        # Remove old UUID course_ids
        if "course_ids" in c:
            del c["course_ids"]
        print(f"OK: {name} -> club={club_id}, course={course_id}, aff={aff}")
    else:
        print(f"FAIL: {name} -> club={club_id}, course={course_id}, aff={aff}")

with open("courses.json", "w") as f:
    json.dump(courses, f, indent=2)
print("\nDone")
