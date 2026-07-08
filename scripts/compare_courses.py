import json
import csv
import os
import re

def normalize_name(name):
    # Lowercase, remove non-alphanumeric except spaces, strip
    name = name.lower()
    # Remove content in parentheses
    name = re.sub(r'\([^)]*\)', '', name)
    # Remove common suffixes
    for suffix in [
        'golf course', 'golf club', 'country club', 'gc', 'cc', 'club', 'resort', 'links', 'course', 'park', 'at', '&', 'and'
    ]:
        name = re.sub(r'\b' + re.escape(suffix) + r'\b', '', name)
    # Remove extra spaces and non-alphanumeric
    name = re.sub(r'[^a-z0-9 ]', '', name)
    name = re.sub(r'\s+', ' ', name)
    return name.strip()

def load_courses_json(path):
    with open(path, 'r') as f:
        return json.load(f)

def load_uga_directory(path):
    # UGA_Directory.json is a list of lists, each with course name as first element
    courses = []
    with open(path, 'r') as f:
        data = f.read()
        # Use regex to extract the first quoted string from each bracketed block
        import re
        matches = re.findall(r'\[\s*"([^"]+)"', data)
        courses.extend(matches)
    return courses

def main():

    from rapidfuzz import process, fuzz

    uga_path = os.path.join(os.path.dirname(__file__), '../UGA_Directory.json')
    courses_path = os.path.join(os.path.dirname(__file__), '../courses.json')
    output_path = os.path.join(os.path.dirname(__file__), '../missing_courses_checklist.csv')

    # Load and normalize course names
    uga_courses = load_uga_directory(uga_path)
    uga_names = {normalize_name(name): name for name in uga_courses}

    courses_data = load_courses_json(courses_path)
    existing_names = set()
    existing_name_map = {}
    for entry in courses_data:
        name = entry.get('name', '')
        norm = normalize_name(name)
        existing_names.add(norm)
        existing_name_map[norm] = name

    # Fuzzy match threshold
    THRESHOLD = 85

    missing = []
    for norm, orig in uga_names.items():
        # Exact match
        if norm in existing_names:
            continue
        # Fuzzy match
        match, score, _ = process.extractOne(norm, existing_names, scorer=fuzz.ratio)
        if score >= THRESHOLD:
            # Add as possible match for review
            missing.append((orig, existing_name_map[match], f'Possible match (score {score})'))
        else:
            missing.append((orig, '', ''))

    # Write CSV checklist
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['Course Name', 'Possible Match in courses.json', 'Notes'])
        for course, possible, note in missing:
            writer.writerow([course, possible, note])
    print(f'Checklist written to {output_path} with {len(missing)} missing or possible matches.')

if __name__ == '__main__':
    main()
