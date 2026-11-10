/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** GitVersion version of this build (set by the Docker build). */
  readonly VITE_APP_VERSION?: string
  /** Commit the build was made from. */
  readonly VITE_GIT_SHA?: string
}
