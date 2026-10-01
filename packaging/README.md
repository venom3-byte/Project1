# Forge Platform Packaging

This directory is the native-output layer for Forge projects.

The web packager creates a self-contained Forge runtime directory from a .forge.json project plus optional assets. Capacitor wraps that runtime into Android, while Electron Forge wraps the same runtime into a Windows desktop application.

The platform workflow builds a real Android debug APK and a Windows package from the committed sample project. It is separate from the main Forge proof workflow so native toolchains cannot regress editor, Vision, asset or gameplay verification.

The current runtime still loads PlayCanvas/Rapier modules from their CDN URLs. That keeps native builds runtime-equivalent to the proven web build, but it is not an offline engine distribution. Offline/vendor packaging is the next hardening stage.
