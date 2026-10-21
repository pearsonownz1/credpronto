const UPLOAD_PATH = "/translate";

/** Signed-out Get started goes through account creation, then back to upload. */
export function uploadStartHref(signedIn: boolean, upload = UPLOAD_PATH): string {
  if (signedIn) return upload;
  return `/sign-up?next=${encodeURIComponent(upload)}`;
}
