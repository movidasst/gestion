/**
 * Google Apps Script — La Movida SST Plus
 *
 * Funciones:
 * 1. Guardar la fotografía del registro en Google Drive.
 * 2. Devolver la URL pública para almacenarla en Supabase.
 * 3. Verificar el registro en Supabase.
 * 4. Confirmar que el registro quedó guardado.
 * 5. Enviar el correo de registro inmediatamente, sin depender de Moodle.
 * 6. Evitar duplicados si la Edge Function vuelve a solicitar el mismo correo.
 *
 * Supabase continúa siendo la base principal.
 * Google Drive conserva únicamente las fotografías.
 */

const SUPABASE_URL =
  'https://lfdmbkzghnwvsapxypvt.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_bRnkA6PA8-v073nrw9zxiQ_8rVGiOn1';


const DIRECTORIO_URL =
  'https://directorio.movidasst.com/';

const REGISTRO_URL =
  'https://registro.movidasst.com/';

const CORREO_RESPUESTA =
  'info@movidasst.com';

const CONTACTO_VERIFICACION_NOMBRE =
  'David Linares Brea';

const CONTACTO_VERIFICACION_TELEFONO =
  '+56968615650';

const CONTACTO_VERIFICACION_TELEFONO_VISIBLE =
  '+56 9 6861 5650';

const LOGO_URL =
  'https://assets.poap.xyz/ff0a7e68-7080-4798-af10-4a481f762e71.jpeg';

/**
 * Carpeta de Google Drive donde se guardarán las fotografías.
 */
const DRIVE_FOLDER_ID =
  '1ukGhXTi0apb8huTTbduynEMO1mpHNTBD';

/**
 * Tamaño máximo permitido: 5 MB.
 */
const MAX_PHOTO_BYTES =
  5 * 1024 * 1024;


/**
 * Ejecuta manualmente esta función una sola vez desde el editor.
 *
 * Sirve para autorizar:
 * - Google Drive
 * - Envío de correos
 * - Consultas externas a Supabase
 */
function autorizarServicios() {
  const folder =
    DriveApp.getFolderById(DRIVE_FOLDER_ID);

  const cuota =
    MailApp.getRemainingDailyQuota();

  Logger.log(
    'Carpeta de fotografías: ' + folder.getName()
  );

  Logger.log(
    'Cuota diaria de correo disponible: ' + cuota
  );

  return {
    folder: folder.getName(),
    remainingMailQuota: cuota
  };
}


/**
 * Permite comprobar que el servicio está publicado.
 */
function doGet() {
  return respuestaJson_({
    result: 'success',
    service: 'registro-movida-sst',
    drive_folder_id: DRIVE_FOLDER_ID,
    message:
      'Servicio de fotografías y correo único de registro + Moodle activo.'
  });
}


/**
 * Recibe las solicitudes del formulario.
 *
 * Acciones admitidas:
 *
 * upload_registration_photo
 * Guarda la fotografía en Google Drive.
 *
 * send_registration_email
 * Confirma el registro y envía inmediatamente el correo con cédula + código.
 *
 * send_moodle_access_email
 * Reintenta/actualiza el mismo correo desde la Edge Function.
 * La caché evita duplicarlo cuando ya fue enviado por el formulario.
 */
function doPost(e) {
  try {
    const parametros =
      obtenerParametrosSolicitud_(e);

    const action =
      String(parametros.action || '').trim();

    if (action === 'upload_registration_photo') {
      return subirFotoRegistroDrive_(parametros);
    }

    if (action === 'send_registration_email') {
      return procesarCorreoRegistro_(parametros);
    }

    if (action === 'send_admin_campaign_email') {
      return procesarCorreoCampanaAdmin_(parametros);
    }

    if (action === 'send_moodle_access_email') {
      return procesarCorreoAccesoMoodle_(parametros);
    }

    return respuestaJson_({
      result: 'error',
      code: 'ACTION_NOT_ALLOWED',
      message: 'Acción no permitida.'
    });

  } catch (error) {
    console.error(error);

    return respuestaJson_({
      result: 'error',
      code: 'INTERNAL_ERROR',
      message:
        error && error.message
          ? error.message
          : String(error)
    });
  }
}


/**
 * Admite solicitudes application/x-www-form-urlencoded y JSON.
 */
function obtenerParametrosSolicitud_(e) {
  const parametros =
    Object.assign(
      {},
      e && e.parameter
        ? e.parameter
        : {}
    );

  const postData =
    e && e.postData
      ? e.postData
      : null;

  if (
    postData &&
    postData.contents &&
    String(postData.type || '')
      .toLowerCase()
      .indexOf('application/json') !== -1
  ) {
    const json =
      JSON.parse(postData.contents);

    if (
      json &&
      typeof json === 'object' &&
      !Array.isArray(json)
    ) {
      Object.keys(json)
        .forEach(function(key) {
          parametros[key] = json[key];
        });
    }
  }

  return parametros;
}



/**
 * Recibe la fotografía comprimida en Base64.
 * La guarda en Google Drive y devuelve una URL pública.
 */
function subirFotoRegistroDrive_(parametros) {
  const cedula =
    String(parametros.cedula || '')
      .replace(/\D/g, '');

  const codigo =
    String(
      parametros.codigo_integrante || ''
    )
      .replace(/\D/g, '');

  const mimeType =
    String(parametros.mime_type || '')
      .toLowerCase()
      .trim();

  const base64 =
    String(parametros.foto_base64 || '')
      .trim();

  if (!/^\d{6,12}$/.test(cedula)) {
    return respuestaJson_({
      result: 'error',
      message: 'Cédula inválida.'
    });
  }

  if (!/^\d{5}$/.test(codigo)) {
    return respuestaJson_({
      result: 'error',
      message:
        'Código de integrante inválido.'
    });
  }

  if (
    ['image/jpeg', 'image/png']
      .indexOf(mimeType) === -1
  ) {
    return respuestaJson_({
      result: 'error',
      message:
        'La fotografía debe ser JPG o PNG.'
    });
  }

  if (!base64) {
    return respuestaJson_({
      result: 'error',
      message:
        'No se recibió la fotografía.'
    });
  }

  /*
   * Antes de guardar cualquier archivo, comprueba que
   * la cédula y el código existan en el Supabase nuevo.
   */
  const integrante =
    obtenerIntegranteSupabase_(
      cedula,
      codigo
    );

  if (!integrante) {
    return respuestaJson_({
      result: 'error',
      message:
        'La cédula y el código no corresponden a un integrante registrado.'
    });
  }

  let bytes;

  try {
    bytes =
      Utilities.base64Decode(base64);
  } catch (error) {
    return respuestaJson_({
      result: 'error',
      message:
        'La fotografía recibida no es válida.'
    });
  }

  if (!bytes || bytes.length === 0) {
    return respuestaJson_({
      result: 'error',
      message:
        'La fotografía está vacía.'
    });
  }

  if (bytes.length > MAX_PHOTO_BYTES) {
    return respuestaJson_({
      result: 'error',
      message:
        'La fotografía supera el máximo permitido de 5 MB.'
    });
  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    const folder =
      DriveApp.getFolderById(
        DRIVE_FOLDER_ID
      );

    const extension =
      mimeType === 'image/png'
        ? 'png'
        : 'jpg';

    const zonaHoraria =
      Session.getScriptTimeZone() ||
      'GMT';

    const fecha =
      Utilities.formatDate(
        new Date(),
        zonaHoraria,
        'yyyyMMdd_HHmmss'
      );

    const nombre =
      'integrante_' +
      cedula +
      '_' +
      codigo +
      '_' +
      fecha +
      '.' +
      extension;

    const blob =
      Utilities.newBlob(
        bytes,
        mimeType,
        nombre
      );

    const archivo =
      folder.createFile(blob);

    archivo.setDescription(
      'Fotografía de registro de La Movida SST Plus. ' +
      'Cédula: ' +
      cedula +
      '. Código: ' +
      codigo +
      '.'
    );

    try {
      archivo.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );
    } catch (sharingError) {
      console.warn(
        'No se pudo cambiar el acceso público:',
        sharingError
      );
    }

    const fileId =
      archivo.getId();

    const fotoUrl =
      'https://lh3.googleusercontent.com/d/' +
      fileId;

    const driveViewUrl =
      'https://drive.google.com/file/d/' +
      fileId +
      '/view';

    /*
     * Vincular la foto mediante la función segura.
     * Si falla, se elimina el archivo para no dejar
     * fotografías huérfanas en Drive.
     */
    try {
      actualizarFotoSupabase_(
        cedula,
        codigo,
        fotoUrl
      );
    } catch (errorSupabase) {
      try {
        archivo.setTrashed(true);
      } catch (trashError) {
        console.warn(
          'No se pudo enviar a la papelera la fotografía huérfana:',
          trashError
        );
      }

      throw errorSupabase;
    }

    return respuestaJson_({
      result: 'success',
      message:
        'Fotografía guardada y vinculada al integrante.',
      file_id: fileId,
      foto_url: fotoUrl,
      drive_view_url: driveViewUrl
    });

  } finally {
    lock.releaseLock();
  }
}


/**
 * Confirma que la cédula y el código existen en Supabase.
 *
 * IMPORTANTE:
 * Esta acción envía el correo de registro INMEDIATAMENTE después de que
 * Supabase confirma la cédula + código. El envío no depende de que Moodle
 * termine correctamente. La caché compartida evita un segundo correo cuando
 * la Edge Function termina la vinculación unos segundos después.
 */
function procesarCorreoCampanaAdmin_(parametros) {
  const secretoEsperado = PropertiesService
    .getScriptProperties()
    .getProperty('MOODLE_EMAIL_SECRET');
  const secretoRecibido = String(parametros.secret || '');

  if (!secretoEsperado || !compararTextoSeguro_(secretoRecibido, secretoEsperado)) {
    return respuestaJson_({
      result: 'error',
      code: 'UNAUTHORIZED',
      message: 'Solicitud no autorizada.'
    });
  }

  const recipient = String(parametros.recipient || '').trim().toLowerCase();
  const subject = String(parametros.subject || '').trim().slice(0, 180);
  const htmlBody = String(parametros.html_body || '');
  const plainBody = String(parametros.plain_body || '').trim();
  const campaignId = String(parametros.campaign_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const recipientId = String(parametros.recipient_id || '').replace(/[^a-zA-Z0-9_-]/g, '');

  if (!esCorreoValido_(recipient) || !subject || !htmlBody || htmlBody.length > 200000) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_CAMPAIGN_EMAIL',
      message: 'Destinatario, asunto o contenido de campaña inválido.'
    });
  }

  if (MailApp.getRemainingDailyQuota() <= 200) {
    return respuestaJson_({
      result: 'error',
      code: 'CAMPAIGN_QUOTA_RESERVED',
      message: 'Se reservó la cuota restante para registros y correos esenciales.'
    });
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'campana_' + campaignId + '_' + recipientId;
  if (campaignId && recipientId && cache.get(cacheKey)) {
    return respuestaJson_({result: 'success', email_sent: true, already_sent: true});
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (campaignId && recipientId && cache.get(cacheKey)) {
      return respuestaJson_({result: 'success', email_sent: true, already_sent: true});
    }
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: plainBody || 'Tienes una nueva comunicación de La Movida SST Plus.',
      htmlBody: htmlBody,
      name: 'La Movida SST Plus',
      replyTo: CORREO_RESPUESTA
    });
    if (campaignId && recipientId) cache.put(cacheKey, '1', 21600);
    return respuestaJson_({result: 'success', email_sent: true});
  } catch (error) {
    return respuestaJson_({
      result: 'error',
      code: 'CAMPAIGN_SEND_ERROR',
      message: error && error.message ? error.message : 'No se pudo enviar el correo.'
    });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function procesarCorreoRegistro_(parametros) {
  const cedula =
    String(parametros.cedula || '')
      .replace(/\D/g, '');

  const codigo =
    String(parametros.codigo_integrante || '')
      .trim()
      .toUpperCase();

  if (!/^\d{6,12}$/.test(cedula)) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_DNI',
      message: 'Cédula inválida.'
    });
  }

  if (!/^[A-Z0-9]{5}$/.test(codigo)) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_MEMBER_CODE',
      message:
        'El código debe contener exactamente cinco caracteres alfanuméricos.'
    });
  }

  const integrante =
    obtenerIntegranteSupabase_(
      cedula,
      codigo
    );

  if (!integrante) {
    return respuestaJson_({
      result: 'error',
      code: 'MEMBER_NOT_FOUND',
      message:
        'No se encontró un registro coincidente en Supabase.'
    });
  }

  const correo =
    String(integrante.correo || '')
      .trim()
      .toLowerCase();

  if (!esCorreoValido_(correo)) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_EMAIL',
      message:
        'El registro no contiene un correo válido.'
    });
  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    const cache =
      CacheService.getScriptCache();

    /*
     * Misma clave para el formulario y para la Edge Function.
     * Así, si Moodle termina la vinculación segundos después,
     * no se envía un segundo correo.
     */
    const cacheKey =
      'correo_unificado_' +
      cedula +
      '_' +
      codigo;

    if (cache.get(cacheKey)) {
      return respuestaJson_({
        result: 'success',
        email_sent: true,
        already_sent: true,
        message:
          'El correo de registro ya había sido procesado.'
      });
    }

    if (
      MailApp.getRemainingDailyQuota() < 1
    ) {
      return respuestaJson_({
        result: 'error',
        code: 'MAIL_QUOTA_EXHAUSTED',
        message:
          'Se agotó la cuota diaria de correo.'
      });
    }

    /*
     * El correo sale AHORA, aunque Moodle aún esté procesando
     * o encuentre una cuenta previa con el mismo correo.
     */
    enviarCorreoUnicoRegistroMoodle_({
      nombres:
        String(integrante.nombres || '').trim(),
      apellidos:
        String(integrante.apellidos || '').trim(),
      correo:
        correo,
      cedula:
        cedula,
      codigo:
        codigo,
      moodleUserId:
        '',
      moodleAccountStatus:
        'PENDIENTE_VERIFICACION',
      estado:
        String(integrante.estado || '').trim(),
      municipio:
        String(integrante.municipio || '').trim()
    });

    cache.put(
      cacheKey,
      '1',
      21600
    );

    return respuestaJson_({
      result: 'success',
      email_sent: true,
      message:
        'Correo de registro enviado correctamente.'
    });

  } finally {
    lock.releaseLock();
  }
}

/**
 * Consulta Supabase usando cédula + código.
 */
function obtenerIntegranteSupabase_(
  cedula,
  codigo
) {
  const filas =
    llamarRpc_(
      'acceso_integrante',
      {
        p_cedula:
          cedula,

        p_codigo:
          codigo
      }
    );

  if (
    !Array.isArray(filas) ||
    filas.length !== 1
  ) {
    return null;
  }

  const integrante =
    filas[0];

  /*
   * acceso_integrante no devuelve el código privado.
   * Se añade sólo en memoria para utilizarlo en el correo.
   */
  integrante.codigo_integrante =
    codigo;

  return integrante;
}


/**
 * Actualiza foto_url mediante la función segura.
 */
function actualizarFotoSupabase_(
  cedula,
  codigo,
  fotoUrl
) {
  const filas =
    llamarRpc_(
      'actualizar_foto_integrante',
      {
        p_cedula:
          cedula,

        p_codigo:
          codigo,

        p_foto_url:
          fotoUrl
      }
    );

  if (
    !Array.isArray(filas) ||
    filas.length !== 1
  ) {
    throw new Error(
      'Supabase no confirmó la actualización de la fotografía.'
    );
  }

  return filas[0];
}


/**
 * Ejecuta una función RPC del Supabase nuevo.
 *
 * La tabla integrantes no se consulta directamente.
 * La clave publicable sólo puede ejecutar las funciones
 * autorizadas en PostgreSQL.
 */
function llamarRpc_(
  nombreFuncion,
  parametros
) {
  const url =
    SUPABASE_URL +
    '/rest/v1/rpc/' +
    encodeURIComponent(
      nombreFuncion
    );

  const response =
    UrlFetchApp.fetch(
      url,
      {
        method:
          'post',

        contentType:
          'application/json',

        payload:
          JSON.stringify(
            parametros || {}
          ),

        headers: {
          apikey:
            SUPABASE_ANON_KEY,

          Authorization:
            'Bearer ' +
            SUPABASE_ANON_KEY,

          Accept:
            'application/json'
        },

        muteHttpExceptions:
          true
      }
    );

  const status =
    response.getResponseCode();

  const body =
    response.getContentText();

  if (
    status < 200 ||
    status >= 300
  ) {
    let message =
      'Supabase rechazó la operación.';

    try {
      const parsed =
        JSON.parse(
          body || '{}'
        );

      if (parsed.message) {
        message =
          parsed.message;
      }
    } catch (parseError) {
      console.warn(
        'No se pudo interpretar el error enviado por Supabase.'
      );
    }

    console.error(
      'RPC ' +
      nombreFuncion +
      ' respondió ' +
      status +
      ': ' +
      body
    );

    throw new Error(message);
  }

  return JSON.parse(
    body || '[]'
  );
}


/**
 * ============================================================
 * CORREO ÚNICO: REGISTRO + DIRECTORIO + MOODLE
 * LA MOVIDA SST PLUS
 * ============================================================
 *
 * Esta acción puede ser invocada por la Edge Function para completar o
 * reintentar el estado de acceso Moodle. El correo inicial ya puede haber
 * sido enviado por send_registration_email; la caché compartida impide
 * duplicarlo. También admite PENDIENTE_VERIFICACION.
 */
function procesarCorreoAccesoMoodle_(parametros) {
  const secretoEsperado =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty('MOODLE_EMAIL_SECRET') || ''
    ).trim();

  const secretoRecibido =
    String(parametros.secret || '').trim();

  if (!secretoEsperado) {
    return respuestaJson_({
      result: 'error',
      code: 'SECRET_NOT_CONFIGURED',
      message:
        'El secreto MOODLE_EMAIL_SECRET no está configurado.'
    });
  }

  if (
    !secretoRecibido ||
    !compararTextoSeguro_(
      secretoRecibido,
      secretoEsperado
    )
  ) {
    return respuestaJson_({
      result: 'error',
      code: 'UNAUTHORIZED',
      message: 'Solicitud no autorizada.'
    });
  }

  const nombres =
    String(parametros.nombres || '')
      .replace(/\s+/g, ' ')
      .trim();

  const apellidos =
    String(parametros.apellidos || '')
      .replace(/\s+/g, ' ')
      .trim();

  const correo =
    String(parametros.correo || '')
      .trim()
      .toLowerCase();

  const cedula =
    String(parametros.cedula || '')
      .replace(/\D/g, '');

  const codigo =
    String(parametros.codigo_integrante || '')
      .trim()
      .toUpperCase();

  const moodleUserId =
    String(parametros.moodle_user_id || '')
      .replace(/\D/g, '');

  const moodleAccountStatus =
    String(parametros.moodle_account_status || '')
      .trim()
      .toUpperCase();

  const estado =
    String(parametros.estado || '')
      .replace(/\s+/g, ' ')
      .trim();

  const municipio =
    String(parametros.municipio || '')
      .replace(/\s+/g, ' ')
      .trim();

  if (!nombres) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_NAME',
      message: 'No se recibieron los nombres.'
    });
  }

  if (!apellidos) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_LASTNAME',
      message: 'No se recibieron los apellidos.'
    });
  }

  if (!/^\d{6,12}$/.test(cedula)) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_DNI',
      message: 'La cédula no tiene un formato válido.'
    });
  }

  if (!/^[A-Z0-9]{5}$/.test(codigo)) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_PASSWORD',
      message:
        'El código debe contener exactamente cinco caracteres alfanuméricos.'
    });
  }

  if (!esCorreoValido_(correo)) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_EMAIL',
      message: 'El correo electrónico no es válido.'
    });
  }

  if (
    moodleAccountStatus !== 'PENDIENTE_VERIFICACION' &&
    !/^\d+$/.test(moodleUserId)
  ) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_MOODLE_ID',
      message: 'El identificador de Moodle no es válido.'
    });
  }

  if (
    ['CREADO', 'EXISTENTE', 'PENDIENTE_VERIFICACION']
      .indexOf(moodleAccountStatus) === -1
  ) {
    return respuestaJson_({
      result: 'error',
      code: 'INVALID_MOODLE_ACCOUNT_STATUS',
      message:
        'El estado de la cuenta Moodle no es válido.'
    });
  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    const cache =
      CacheService.getScriptCache();

    const cacheKey =
      'correo_unificado_' +
      cedula +
      '_' +
      codigo;

    /*
     * Evita que un reintento inmediato de la Edge Function
     * envíe el mismo correo varias veces.
     */
    if (cache.get(cacheKey)) {
      return respuestaJson_({
        result: 'success',
        message:
          'El correo único ya había sido procesado.',
        already_sent: true
      });
    }

    if (
      MailApp.getRemainingDailyQuota() < 1
    ) {
      return respuestaJson_({
        result: 'error',
        code: 'MAIL_QUOTA_EXHAUSTED',
        message:
          'Se agotó la cuota diaria de correo.'
      });
    }

    enviarCorreoUnicoRegistroMoodle_({
      nombres: nombres,
      apellidos: apellidos,
      correo: correo,
      cedula: cedula,
      codigo: codigo,
      moodleUserId: moodleUserId,
      moodleAccountStatus: moodleAccountStatus,
      estado: estado,
      municipio: municipio
    });

    /*
     * Evita otro envío equivalente durante seis horas.
     * El control permanente lo mantiene Supabase.
     */
    cache.put(
      cacheKey,
      '1',
      21600
    );

    return respuestaJson_({
      result: 'success',
      message:
        'Correo único de registro y acceso a Moodle enviado correctamente.'
    });

  } finally {
    lock.releaseLock();
  }
}


/**
 * Envía un único correo que contiene:
 * - Confirmación del registro en La Movida SST Plus.
 * - Código único de integrante.
 * - Acceso al directorio y a la credencial.
 * - Usuario y contraseña inicial de Moodle.
 */
function enviarCorreoUnicoRegistroMoodle_(datos) {
  const nombreCompleto =
    (
      datos.nombres +
      ' ' +
      datos.apellidos
    ).trim() || 'Integrante';

  const moodleUrl =
    'https://movidasst.org/login/index.php';

  const cuentaNueva =
    datos.moodleAccountStatus === 'CREADO';

  const ubicacion =
    [
      datos.municipio,
      datos.estado
    ]
      .filter(Boolean)
      .join(', ');

  const credentialUrl =
    DIRECTORIO_URL +
    '?verificar=' +
    encodeURIComponent(datos.cedula);

  const whatsappContactoUrl =
    'https://wa.me/' +
    CONTACTO_VERIFICACION_TELEFONO
      .replace(/\D/g, '');

  const telefonoContactoUrl =
    'tel:' +
    CONTACTO_VERIFICACION_TELEFONO;

  const asunto =
    'Bienvenido a La Movida SST Plus — Tus credenciales están listas';

  const textoPlano = [
    'Hola, ' + nombreCompleto + ':',
    '',
    '¡Tu registro en La Movida SST Plus fue completado correctamente!',
    '',
    'TUS CREDENCIALES',
    'Usuario: ' + datos.cedula,
    'Código de registro: ' + datos.codigo,
    '',
    'Tu número de cédula y tu código de registro son tus credenciales de acceso al ecosistema de La Movida SST Plus.',
    '',
    'Con estas credenciales puedes acceder al Directorio, actualizar tus datos, consultar tu credencial digital y utilizar los servicios habilitados.',
    '',
    'ACADEMIA MOVIDA SST',
    cuentaNueva
      ? 'Tu nueva cuenta en Moodle quedó habilitada con estas mismas credenciales.'
      : cuentaExistente
        ? 'Tu cuenta de Moodle existente quedó vinculada y la contraseña fue unificada con tu código de registro.'
        : 'Si ya tenías una cuenta en Moodle, la vinculación segura puede tardar unos minutos. Tu registro y tu código ya son válidos para el Directorio y los demás servicios.',
    cuentaPendiente
      ? 'Mientras se completa la vinculación, Moodle puede conservar temporalmente la contraseña anterior de esa cuenta.'
      : 'Usuario Moodle: ' + datos.cedula,
    cuentaPendiente
      ? ''
      : 'Contraseña Moodle: ' + datos.codigo,
    'Ingresar: ' + moodleUrl,
    '',
    'DIRECTORIO Y CREDENCIAL',
    'Ver o validar credencial: ' + credentialUrl,
    'Directorio nacional: ' + DIRECTORIO_URL,
    ubicacion
      ? 'Ubicación registrada: ' + ubicacion
      : '',
    '',
    'IMPORTANTE — CONTACTO OFICIAL PARA VERIFICACIÓN',
    'Guarda en tus contactos a:',
    CONTACTO_VERIFICACION_NOMBRE,
    CONTACTO_VERIFICACION_TELEFONO_VISIBLE,
    '',
    'Guarda tu código en un lugar seguro y no lo compartas.',
    '',
    'La Movida SST Plus',
    'De la reacción a la prevención.',
    '',
    'Contacto institucional: ' + CORREO_RESPUESTA
  ]
    .filter(Boolean)
    .join('\n');

  const preheader =
    cuentaPendiente
      ? 'Tu registro está listo. Recibe tu cédula y código aunque tu cuenta Moodle aún esté en proceso de vinculación.'
      : 'Tu cédula y código de registro son ahora tus credenciales unificadas de La Movida SST Plus.';

  const htmlBody = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <title>
    Bienvenido a La Movida SST Plus
  </title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background-color:#eef3f8;
    font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;
    color:#334155;
  "
>
  <div
    style="
      display:none;
      max-height:0;
      overflow:hidden;
      opacity:0;
      color:transparent;
    "
  >
    ${escaparHtml_(preheader)}
  </div>

  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="width:100%;background-color:#eef3f8;"
  >
    <tr>
      <td
        align="center"
        style="padding:22px 12px;"
      >
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            width:100%;
            max-width:640px;
            background:#ffffff;
            border:1px solid #dce5ee;
            border-radius:22px;
            overflow:hidden;
            box-shadow:0 12px 34px rgba(0,32,91,.10);
          "
        >
          <tr>
            <td
              style="
                height:7px;
                background:#00247d;
                background:linear-gradient(
                  90deg,
                  #ffcc00 0 33.33%,
                  #00247d 33.33% 66.66%,
                  #cf142b 66.66%
                );
                font-size:0;
                line-height:0;
              "
            >
              &nbsp;
            </td>
          </tr>

          <tr>
            <td
              align="center"
              style="
                padding:27px 22px 24px;
                background:#004d6d;
                background:linear-gradient(
                  135deg,
                  #00205b 0%,
                  #004d6d 55%,
                  #007b85 100%
                );
              "
            >
              <img
                src="${LOGO_URL}"
                width="76"
                height="76"
                alt="La Movida SST Plus"
                style="
                  display:block;
                  width:76px;
                  height:76px;
                  border-radius:50%;
                  border:4px solid rgba(255,255,255,.95);
                  box-shadow:0 6px 18px rgba(0,0,0,.22);
                  object-fit:cover;
                "
              >

              <div
                style="
                  margin-top:14px;
                  font-size:25px;
                  line-height:1.15;
                  font-weight:800;
                  color:#ffffff;
                "
              >
                La Movida SST Plus
              </div>

              <div
                style="
                  margin-top:7px;
                  font-size:11px;
                  line-height:1.4;
                  font-weight:700;
                  letter-spacing:1.5px;
                  text-transform:uppercase;
                  color:#bdf5f2;
                "
              >
                De la reacción a la prevención
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 25px 8px;">
              <div
                style="
                  display:inline-block;
                  padding:7px 12px;
                  border-radius:999px;
                  background:#e8f8f7;
                  color:#00666f;
                  font-size:11px;
                  font-weight:800;
                  letter-spacing:.7px;
                  text-transform:uppercase;
                "
              >
                ${
                  cuentaNueva
                    ? 'Registro y cuenta habilitados'
                    : cuentaExistente
                      ? 'Registro y cuenta unificados'
                      : 'Registro listo · Moodle en vinculación'
                }
              </div>

              <h1
                style="
                  margin:16px 0 10px;
                  font-size:25px;
                  line-height:1.22;
                  color:#00205b;
                  font-weight:800;
                "
              >
                ¡Bienvenido,
                ${escaparHtml_(datos.nombres || nombreCompleto)}!
              </h1>

              <p
                style="
                  margin:0;
                  font-size:15px;
                  line-height:1.7;
                  color:#475569;
                "
              >
                Tu registro en
                <strong style="color:#00205b;">
                  La Movida SST Plus
                </strong>
                fue completado correctamente y
                ${
                  cuentaNueva
                    ? `tu nueva cuenta en la
                      <strong style="color:#007b85;">
                        Academia Movida SST
                      </strong>
                      ya está disponible con las mismas credenciales.`
                    : cuentaExistente
                      ? `quedó vinculado con la cuenta que ya tenías en la
                        <strong style="color:#007b85;">
                          Academia Movida SST
                        </strong>, utilizando ahora las mismas credenciales.`
                      : `tu código ya está habilitado para el
                        <strong style="color:#007b85;">
                          Directorio y el ecosistema
                        </strong>. Si ya tenías cuenta en Moodle, su vinculación segura
                        se está procesando por separado.`
                }
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 25px 5px;">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width:100%;
                  background:#effcfc;
                  border:1px solid #99d7d9;
                  border-radius:18px;
                "
              >
                <tr>
                  <td
                    align="center"
                    style="padding:21px 16px;"
                  >
                    <div
                      style="
                        font-size:11px;
                        font-weight:800;
                        letter-spacing:1.2px;
                        text-transform:uppercase;
                        color:#64748b;
                      "
                    >
                      Tu código único de integrante
                    </div>

                    <div
                      style="
                        margin-top:8px;
                        font-family:'Courier New',monospace;
                        font-size:36px;
                        line-height:1;
                        font-weight:900;
                        letter-spacing:7px;
                        color:#007b85;
                      "
                    >
                      ${escaparHtml_(datos.codigo)}
                    </div>

                    <div
                      style="
                        margin-top:11px;
                        font-size:12px;
                        line-height:1.6;
                        color:#64748b;
                      "
                    >
                      Tu número de cédula y este código de registro son tus
                      credenciales de acceso a La Movida SST Plus. Úsalos para
                      ingresar al Directorio, actualizar tus datos y consultar
                      tu credencial. Cuando Moodle esté vinculado, el mismo
                      código será también tu contraseña de la Academia.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 25px 5px;">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width:100%;
                  background:#f4f8fb;
                  border:1px solid #d7e3ed;
                  border-radius:17px;
                "
              >
                <tr>
                  <td style="padding:20px;">
                    <div
                      style="
                        color:#00205b;
                        font-size:14px;
                        font-weight:900;
                        letter-spacing:.5px;
                        text-transform:uppercase;
                      "
                    >
                      Acceso a la Academia Movida SST
                    </div>

                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="width:100%;margin-top:12px;"
                    >
                      <tr>
                        <td
                          style="
                            padding:10px 0;
                            color:#64748b;
                            font-size:14px;
                            border-bottom:1px solid #dce5ee;
                          "
                        >
                          Usuario
                        </td>

                        <td
                          align="right"
                          style="
                            padding:10px 0;
                            color:#00205b;
                            font-size:17px;
                            font-weight:900;
                            border-bottom:1px solid #dce5ee;
                          "
                        >
                          ${escaparHtml_(datos.cedula)}
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:13px 0 4px;
                            color:#64748b;
                            font-size:14px;
                          "
                        >
                          ${
                            cuentaPendiente
                              ? 'Estado'
                              : 'Contraseña'
                          }
                        </td>

                        <td
                          align="right"
                          style="
                            padding:13px 0 4px;
                            color:#007b85;
                            font-size:${cuentaPendiente ? '13px' : '19px'};
                            font-weight:900;
                            letter-spacing:${cuentaPendiente ? '0' : '2px'};
                          "
                        >
                          ${
                            cuentaPendiente
                              ? 'Vinculación segura en proceso'
                              : escaparHtml_(datos.codigo)
                          }
                        </td>
                      </tr>
                    </table>

                    ${
                      cuentaPendiente
                        ? `
                          <div
                            style="
                              margin-top:14px;
                              padding:12px 13px;
                              border-radius:10px;
                              background:#fff9e7;
                              border:1px solid #f0d98c;
                              color:#67521a;
                              font-size:12px;
                              line-height:1.55;
                            "
                          >
                            Detectamos que este correo ya existe en Moodle,
                            pero la cuenta todavía no contiene una cédula o
                            ID coincidente que permita vincularla con seguridad.
                            Tu registro está completo y tu código ya funciona
                            para el Directorio y los demás servicios. Mientras
                            se completa la vinculación, Moodle puede conservar
                            temporalmente la contraseña anterior.
                          </div>
                        `
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td
              align="center"
              style="padding:20px 25px 7px;"
            >
              <a
                href="${moodleUrl}"
                style="
                  display:inline-block;
                  width:100%;
                  max-width:355px;
                  padding:15px 18px;
                  box-sizing:border-box;
                  color:#ffffff;
                  background:#005b77;
                  background:linear-gradient(
                    135deg,
                    #00205b,
                    #007b85
                  );
                  border-radius:12px;
                  font-size:15px;
                  font-weight:800;
                  text-decoration:none;
                  text-align:center;
                  box-shadow:0 8px 20px rgba(0,32,91,.20);
                "
              >
                Ingresar a la Academia
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 25px 5px;">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width:100%;
                  background:#f8fafc;
                  border:1px solid #e2e8f0;
                  border-radius:15px;
                "
              >
                <tr>
                  <td style="padding:16px 17px;">
                    <div
                      style="
                        color:#00205b;
                        font-size:14px;
                        font-weight:900;
                      "
                    >
                      Directorio y credencial digital
                    </div>

                    <div
                      style="
                        margin-top:7px;
                        font-size:13px;
                        line-height:1.65;
                        color:#64748b;
                      "
                    >
                      Usa tu cédula y el mismo código para consultar,
                      actualizar tus datos y gestionar tu credencial.
                    </div>

                    ${
                      ubicacion
                        ? `
                          <div
                            style="
                              margin-top:8px;
                              font-size:13px;
                              color:#64748b;
                            "
                          >
                            <strong style="color:#334155;">
                              Ubicación registrada:
                            </strong>
                            ${escaparHtml_(ubicacion)}
                          </div>
                        `
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td
              align="center"
              style="padding:18px 25px 7px;"
            >
              <a
                href="${credentialUrl}"
                style="
                  display:inline-block;
                  padding:14px 24px;
                  border-radius:12px;
                  background:#ffffff;
                  color:#00205b;
                  border:2px solid #00205b;
                  text-decoration:none;
                  font-size:14px;
                  font-weight:800;
                "
              >
                Ver y descargar mi credencial
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 25px 5px;">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width:100%;
                  background:#fff8db;
                  border:1px solid #f0d167;
                  border-radius:18px;
                "
              >
                <tr>
                  <td style="padding:18px;">
                    <div
                      style="
                        font-size:13px;
                        font-weight:900;
                        letter-spacing:.5px;
                        text-transform:uppercase;
                        color:#7a5700;
                      "
                    >
                      Contacto oficial para verificación
                    </div>

                    <div
                      style="
                        margin-top:7px;
                        font-size:14px;
                        line-height:1.6;
                        color:#4b5563;
                      "
                    >
                      Guarda en tus contactos a:
                    </div>

                    <div
                      style="
                        margin-top:10px;
                        font-size:17px;
                        font-weight:900;
                        color:#00205b;
                      "
                    >
                      ${escaparHtml_(CONTACTO_VERIFICACION_NOMBRE)}
                    </div>

                    <div
                      style="
                        margin-top:3px;
                        font-size:17px;
                        font-weight:800;
                        color:#007b85;
                      "
                    >
                      ${escaparHtml_(CONTACTO_VERIFICACION_TELEFONO_VISIBLE)}
                    </div>

                    <table
                      role="presentation"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="margin-top:15px;"
                    >
                      <tr>
                        <td style="padding-right:8px;">
                          <a
                            href="${whatsappContactoUrl}"
                            style="
                              display:inline-block;
                              padding:11px 15px;
                              border-radius:11px;
                              background:#128c7e;
                              color:#ffffff;
                              text-decoration:none;
                              font-size:13px;
                              font-weight:800;
                            "
                          >
                            Abrir WhatsApp
                          </a>
                        </td>

                        <td>
                          <a
                            href="${telefonoContactoUrl}"
                            style="
                              display:inline-block;
                              padding:11px 15px;
                              border-radius:11px;
                              background:#00205b;
                              color:#ffffff;
                              text-decoration:none;
                              font-size:13px;
                              font-weight:800;
                            "
                          >
                            Llamar
                          </a>
                        </td>
                      </tr>
                    </table>

                    <div
                      style="
                        margin-top:12px;
                        font-size:11px;
                        line-height:1.5;
                        color:#806b25;
                      "
                    >
                      Se adjunta una tarjeta de contacto (.VCF)
                      para guardarlo directamente en tu teléfono.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 25px 27px;">
              <div
                style="
                  padding:14px 16px;
                  color:#67521a;
                  background:#fff9e7;
                  border:1px solid #f0d98c;
                  border-radius:11px;
                  font-size:13px;
                  line-height:1.55;
                "
              >
                <strong>Importante:</strong>
                guarda tu código en un lugar seguro.
                No lo compartas con otras personas.
              </div>
            </td>
          </tr>

          <tr>
            <td
              align="center"
              style="
                padding:20px 22px;
                background:#f7fafc;
                border-top:1px solid #e2e8f0;
              "
            >
              <div
                style="
                  color:#00205b;
                  font-size:13px;
                  font-weight:800;
                "
              >
                La Movida SST Plus · Venezuela
              </div>

              <div
                style="
                  margin-top:6px;
                  color:#64748b;
                  font-size:11px;
                  line-height:1.6;
                "
              >
                Actualización profesional continua
              </div>

              <div
                style="
                  margin-top:10px;
                  font-size:11px;
                  line-height:1.7;
                "
              >
                <a
                  href="${DIRECTORIO_URL}"
                  style="
                    color:#007b85;
                    text-decoration:none;
                    font-weight:700;
                  "
                >
                  Directorio nacional
                </a>

                <span style="color:#cbd5e1;"> · </span>

                <a
                  href="${REGISTRO_URL}"
                  style="
                    color:#007b85;
                    text-decoration:none;
                    font-weight:700;
                  "
                >
                  Registro
                </a>

                <span style="color:#cbd5e1;"> · </span>

                <a
                  href="mailto:${CORREO_RESPUESTA}"
                  style="
                    color:#007b85;
                    text-decoration:none;
                    font-weight:700;
                  "
                >
                  ${CORREO_RESPUESTA}
                </a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const vcard =
    crearVCardContacto_();

  MailApp.sendEmail(
    datos.correo,
    asunto,
    textoPlano,
    {
      htmlBody: htmlBody,
      name: 'La Movida SST Plus',
      replyTo: CORREO_RESPUESTA,
      attachments: [vcard]
    }
  );
}

/**
 * Compara secretos mediante SHA-256 para evitar
 * una comparación directa del valor original.
 */
function compararTextoSeguro_(
  textoRecibido,
  textoEsperado
) {
  const hashRecibido =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(textoRecibido),
      Utilities.Charset.UTF_8
    );

  const hashEsperado =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(textoEsperado),
      Utilities.Charset.UTF_8
    );

  if (
    hashRecibido.length !==
    hashEsperado.length
  ) {
    return false;
  }

  let diferencia = 0;

  for (
    let indice = 0;
    indice < hashRecibido.length;
    indice++
  ) {
    diferencia |=
      hashRecibido[indice] ^
      hashEsperado[indice];
  }

  return diferencia === 0;
}


/**
 * Crea una tarjeta de contacto VCF.
 */
function crearVCardContacto_() {
  const contenido = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Linares Brea;David;;;',
    'FN:' +
      CONTACTO_VERIFICACION_NOMBRE,
    'ORG:La Movida SST Plus',
    'TITLE:Fundador',
    'TEL;TYPE=CELL,VOICE,WHATSAPP:' +
      CONTACTO_VERIFICACION_TELEFONO,
    'EMAIL;TYPE=INTERNET:' +
      CORREO_RESPUESTA,
    'URL:https://www.movidasst.com',
    'NOTE:Contacto oficial para fines de verificación ' +
      'de registros y credenciales de La Movida SST Plus.',
    'END:VCARD'
  ].join('\r\n');

  return Utilities.newBlob(
    contenido,
    'text/vcard',
    'David_Linares_Brea_Contacto_Verificacion.vcf'
  );
}


/**
 * Valida el formato básico del correo.
 */
function esCorreoValido_(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(correo);
}


/**
 * Evita que los datos del usuario dañen el HTML.
 */
function escaparHtml_(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/**
 * Devuelve respuestas JSON al formulario.
 */
function respuestaJson_(objeto) {
  return ContentService
    .createTextOutput(
      JSON.stringify(objeto)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}
