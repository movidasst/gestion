from pathlib import Path

engine = Path('supabase/functions/moodle-company-admin/engine.ts')
text = engine.read_text(encoding='utf-8')

anchor = '''async function callMoodleRead(
  functionName: string,
  parameters: Record<string, MoodleParameter> = {},
): Promise<unknown> {
  const token = Deno.env.get("MOODLE_LECTURA_TOKEN")?.trim() || requiredSecret("MOODLE_LECTURA_TOKEN");
  return callMoodleWithToken(functionName, parameters, token);
}
'''
insert = anchor + '''\nasync function callMoodlePrimaryRead(\n  functionName: string,\n  parameters: Record<string, MoodleParameter> = {},\n): Promise<unknown> {\n  return callMoodleWithToken(functionName, parameters, requiredSecret("MOODLE_TOKEN"));\n}\n'''
if 'async function callMoodlePrimaryRead(' not in text:
    if anchor not in text:
        raise SystemExit('No se encontró callMoodleRead en engine.ts')
    text = text.replace(anchor, insert, 1)

old = 'const response = await callMoodle("core_enrol_get_enrolled_users", { courseid: courseId });'
new = 'const response = await callMoodlePrimaryRead("core_enrol_get_enrolled_users", { courseid: courseId });'
if old not in text and new not in text:
    raise SystemExit('No se encontró getCourseStudents')
text = text.replace(old, new, 1)
engine.write_text(text, encoding='utf-8')

search = Path('supabase/functions/moodle-company-user-search/index.ts')
s = search.read_text(encoding='utf-8')

marker = '''async function usersByField(field: "id" | "idnumber" | "email", values: Array<string | number>): Promise<Record<string, unknown>[]> {'''
primary_helper = '''async function callMoodlePrimaryRead(functionName: string, parameters: Record<string, MoodleParameter> = {}): Promise<unknown> {\n  const baseUrl = requiredSecret("MOODLE_BASE_URL").replace(/\\/+$/, "");\n  const form = new URLSearchParams({\n    wstoken: requiredSecret("MOODLE_TOKEN"),\n    wsfunction: functionName,\n    moodlewsrestformat: "json",\n  });\n  for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));\n  const response = await fetch(`${baseUrl}/webservice/rest/server.php`, {\n    method: "POST",\n    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },\n    body: form,\n    signal: AbortSignal.timeout(30000),\n  });\n  const raw = await response.text();\n  let payload: unknown;\n  try { payload = raw ? JSON.parse(raw) : null; }\n  catch { throw new Error(`Moodle devolvió una respuesta no válida (${response.status}).`); }\n  if (!response.ok) throw new Error(`Moodle respondió HTTP ${response.status}.`);\n  if (payload && typeof payload === "object" && !Array.isArray(payload)) {\n    const error = payload as Record<string, unknown>;\n    if (error.exception || error.errorcode) {\n      const code = String(error.errorcode || error.exception || "moodle_error");\n      throw new Error(`${code}: ${String(error.message || "Moodle rechazó la consulta.")}`);\n    }\n  }\n  return payload;\n}\n\n'''
if 'async function callMoodlePrimaryRead(' not in s:
    if marker not in s:
        raise SystemExit('No se encontró punto de inserción en buscador')
    s = s.replace(marker, primary_helper + marker, 1)

old2 = 'const enrolled = asObjects(await callMoodle("core_enrol_get_enrolled_users", { courseid: courseId }));'
new2 = 'const enrolled = asObjects(await callMoodlePrimaryRead("core_enrol_get_enrolled_users", { courseid: courseId }));'
if old2 not in s and new2 not in s:
    raise SystemExit('No se encontró lectura de matriculados en buscador')
s = s.replace(old2, new2, 1)
search.write_text(s, encoding='utf-8')
