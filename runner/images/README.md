# Runtime images

The helper uses the official multi-architecture toolchain images locked in `runtime-images.json`. Browser requests select only a runtime ID; image references and commands are compiled into the helper.

Pull them before working offline:

```sh
docker pull node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
docker pull python:3.14-alpine@sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92
docker pull golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2
docker pull rust:1.94-alpine@sha256:77237dd363a0b127bb5ef532c2d64c0deb380b738e43a9c4bdac73398d6d0a08
```

No runtime package installation or network access is available inside a run.
