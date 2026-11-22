# Servidor descartável do ensaio de instalação (M60, etapa 2): Ubuntu 24.04 com o systemd como processo 1, o mais
# perto possível de um Ubuntu Server limpo (o systemd, o openssl e o iproute2 vêm na imagem de servidor). Só para o
# ensaio na máquina da obra (POL-4): a imagem e o contêiner são apagados no fim.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus openssl iproute2 iptables ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && systemctl mask systemd-firstboot.service systemd-udevd.service getty.target console-getty.service \
 && ln -sf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime
# DS-0002: o usuário padrão da imagem não é root. O systemd como processo 1 exige root, então o ensaio o pede na
# execução (ensaiar.sh, cmd_servidor: docker run --user 0:0), e qualquer outro uso da imagem sobe sem privilégio.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin ensaio
USER 10001:10001
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
