function mediaTypeAllowed(mediaType, microphoneHeld) {
  if (mediaType === 'video') return true
  if (mediaType === 'audio') return microphoneHeld
  return false
}

function mediaTypesAllowed(mediaTypes, microphoneHeld) {
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) return false
  if (mediaTypes.some(type => type !== 'video' && type !== 'audio')) return false
  return microphoneHeld || !mediaTypes.includes('audio')
}

function mediaPermissionAllowed({
  local,
  permission,
  allowedPermissions,
  microphoneHeld,
  mediaType,
  mediaTypes,
}) {
  if (!local || !allowedPermissions.includes(permission)) return false
  if (permission !== 'media') return true
  if (Array.isArray(mediaTypes)) return mediaTypesAllowed(mediaTypes, microphoneHeld)
  return mediaTypeAllowed(mediaType, microphoneHeld)
}

function installMediaPermissionHandlers({ session, local, allowedPermissions, microphoneHeld }) {
  session.setPermissionCheckHandler((_webContents, permission, origin, details) =>
    mediaPermissionAllowed({
      local: local(origin), permission, allowedPermissions,
      microphoneHeld: microphoneHeld(), mediaType: details?.mediaType,
    }))

  session.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(mediaPermissionAllowed({
      local: local(webContents.getURL()), permission, allowedPermissions,
      microphoneHeld: microphoneHeld(), mediaTypes: details?.mediaTypes,
    })))
}

module.exports = {
  installMediaPermissionHandlers,
  mediaPermissionAllowed,
  mediaTypeAllowed,
  mediaTypesAllowed,
}
