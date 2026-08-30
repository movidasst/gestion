from pathlib import Path

# 1) Copia aislada del motor Moodle para Empresas usando el token académico.
src = Path('supabase/functions/moodle-admin/index.ts')
engine = Path('supabase/functions/moodle-company-admin/engine.ts')
engine.parent.mkdir(parents=True, exist_ok=True)
text = src.read_text(encoding='utf-8')
text = text.replace('requiredSecret("MOODLE_TOKEN")', 'requiredSecret("MOODLE_LECTURA_TOKEN")')
engine.write_text(text, encoding='utf-8')

# El entrypoint local queda limpio para futuros despliegues con Supabase CLI.
Path('supabase/functions/moodle-company-admin/index.ts').write_text(
    'import "jsr:@supabase/functions-js/edge-runtime.d.ts";\nimport "./engine.ts";\n',
    encoding='utf-8'
)

# 2) El buscador corporativo usa el mismo servicio académico.
search = Path('supabase/functions/moodle-company-user-search/index.ts')
search_text = search.read_text(encoding='utf-8')
search_text = search_text.replace('requiredSecret("MOODLE_TOKEN")', 'requiredSecret("MOODLE_LECTURA_TOKEN")')
search.write_text(search_text, encoding='utf-8')

# 3) Solo las acciones company_* se enrutan al motor académico aislado.
page = Path('index.html')
html = page.read_text(encoding='utf-8')
old = "async function academyApi(action,payload={}){const {data,error}=await sb.functions.invoke('moodle-admin',{body:{action,...payload}});"
new = "async function academyApi(action,payload={}){const functionName=String(action||'').startsWith('company_')?'moodle-company-admin':'moodle-admin';const {data,error}=await sb.functions.invoke(functionName,{body:{action,...payload}});"
if old not in html:
    raise SystemExit('No se encontró academyApi para enrutar Empresas')
html = html.replace(old, new, 1)
page.write_text(html, encoding='utf-8')
