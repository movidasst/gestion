from pathlib import Path
p=Path('index.html')
text=p.read_text(encoding='utf-8')
text=text.replace('Busca primero por correo, documento o ID Moodle. Si la cuenta existe se reutiliza; si no existe, Gestión la creará al matricular.', 'Busca por nombre, apellido, correo, documento o ID Moodle. Si la cuenta existe se reutiliza; si no existe, Gestión la creará al matricular.')
text=text.replace('placeholder="Correo, documento o ID Moodle"', 'placeholder="Nombre, apellido, correo, documento o ID Moodle"')
old="""async function searchCompanyMoodleUser(){const detail=companyState().courseDetail,query=$('companyMoodleLookup').value.trim();if(!detail)return toast('Abre un curso empresarial.',true);if(!query)return toast('Escribe correo, documento o ID Moodle.',true);showLoading(true);try{const result=await companyMoodleLookupApi({query,company_course_id:detail.companyCourse.id});renderCompanyMoodleSearchResults(result.users||[]);if(result.users?.length)toast(`${result.users.length} cuenta${result.users.length===1?'':'s'} encontrada${result.users.length===1?'':'s'} en Moodle.`)}catch(error){toast(error.message,true)}finally{showLoading(false)}}"""
new="""async function searchCompanyMoodleUser(){const detail=companyState().courseDetail,query=$('companyMoodleLookup').value.trim();if(!detail)return toast('Abre un curso empresarial.',true);if(!query)return toast('Escribe nombre, apellido, correo, documento o ID Moodle.',true);showLoading(true);try{const result=await companyMoodleLookupApi({query,company_course_id:detail.companyCourse.id});renderCompanyMoodleSearchResults(result.users||[]);if(result.users?.length)toast(`${result.users.length} cuenta${result.users.length===1?'':'s'} encontrada${result.users.length===1?'':'s'} en Moodle.`);else{const warning=(result.warnings||[]).find(item=>String(item).includes('core_user_get_users'));if(warning)toast(String(warning),true)}}catch(error){toast(error.message,true)}finally{showLoading(false)}}"""
if old not in text:
    raise SystemExit('search function anchor not found')
text=text.replace(old,new,1)
p.write_text(text,encoding='utf-8')
