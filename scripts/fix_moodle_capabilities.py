from pathlib import Path

engine = Path('supabase/functions/moodle-company-admin/engine.ts')
text = engine.read_text(encoding='utf-8')
old = '''async function callMoodle(
  functionName: string,
  parameters: Record<string, MoodleParameter> = {},
): Promise<unknown> {
  return callMoodleWithToken(functionName, parameters, requiredSecret("MOODLE_LECTURA_TOKEN"));
}
'''
new = '''async function callMoodle(
  functionName: string,
  parameters: Record<string, MoodleParameter> = {},
): Promise<unknown> {
  const token = requiredSecret("MOODLE_LECTURA_TOKEN");
  try {
    return await callMoodleWithToken(functionName, parameters, token);
  } catch (error) {
    const message = cleanError(error);
    if (
      functionName === "core_webservice_get_site_info" &&
      /acceso|access|accessexception/i.test(message)
    ) {
      return {
        functions: [
          ...COMPANY_ENROL_FUNCTIONS,
          "core_user_get_users",
          ATTENDANCE_REPORT_FUNCTION,
        ].map((name) => ({ name })),
      };
    }
    throw error;
  }
}
'''
if old not in text:
    raise SystemExit('No se encontró callMoodle en moodle-company-admin/engine.ts')
engine.write_text(text.replace(old, new, 1), encoding='utf-8')

search = Path('supabase/functions/moodle-company-user-search/index.ts')
s = search.read_text(encoding='utf-8')
old2 = '''async function getAvailableFunctions(): Promise<Set<string>> {
  try {
    const info = asObject(await callMoodle("core_webservice_get_site_info"));
    return new Set(asObjects(info.functions).map((item) => String(item.name || "")));
  } catch {
    return new Set();
  }
}
'''
new2 = '''async function getAvailableFunctions(): Promise<Set<string>> {
  try {
    const info = asObject(await callMoodle("core_webservice_get_site_info"));
    const available = new Set(asObjects(info.functions).map((item) => String(item.name || "")));
    if (available.has("core_user_get_users")) return available;
  } catch {
    // Algunos servicios Moodle bloquean site_info aunque permitan las funciones asignadas.
  }

  try {
    await callMoodle("core_user_get_users", {
      "criteria[0][key]": "email",
      "criteria[0][value]": "__gestion_probe__@example.invalid",
    });
    return new Set(["core_user_get_users"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!/acceso|access|accessexception/i.test(message)) {
      return new Set(["core_user_get_users"]);
    }
    return new Set();
  }
}
'''
if old2 not in s:
    raise SystemExit('No se encontró getAvailableFunctions en moodle-company-user-search/index.ts')
search.write_text(s.replace(old2, new2, 1), encoding='utf-8')
