import json, subprocess

with open('courses.json') as f:
    courses = json.load(f)

chrono = [c for c in courses if c.get('platform') == 'chronogolf']
print(f"Found {len(chrono)} chronogolf courses\n")

def fetch_club(club_id):
    url = f"https://www.chronogolf.com/marketplace/v2/clubs/{club_id}"
    r = subprocess.run(
        ['curl', '-s', url, '-H', 'Accept: application/json',
         '-H', 'X-Requested-With: XMLHttpRequest',
         '-H', 'Referer: https://www.chronogolf.com/'],
        capture_output=True, text=True, timeout=10
    )
    return json.loads(r.stdout)

for c in chrono:
    club_id = c['club_id']
    try:
        data = fetch_club(club_id)
        if 'courses' not in data and 'slug' in data:
            data = fetch_club(data['slug'])
        course_ids = [cc['id'] for cc in data.get('courses', [])]
        aff_id = data.get('default_affiliation_type_id')
        print(f"{c['name']}: course_ids={course_ids}, affiliation={aff_id}")
        c['course_ids'] = course_ids
        c['affiliation_type_id'] = aff_id
    except Exception as e:
        print(f"{c['name']}: ERROR - {e}")

with open('courses.json', 'w') as f:
    json.dump(courses, f, indent=2)
print("\nUpdated courses.json")
