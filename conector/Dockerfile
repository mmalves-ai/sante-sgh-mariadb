# Conector (F4): motor Python que só LÊ bases Firebird de origem.
# Base: o mesmo servidor/cliente Firebird 3.0.14 das cópias de desenvolvimento (biblioteca embarcada).
# Roda sem rede (--network none) ou, nos comandos da fila e do motor, só na rede interna sante-sgh-conector-int
# (Docker --internal, sem saída), onde alcança apenas o MariaDB. argon2-cffi e cryptography (rodada 5, ADR 0007):
# senha legível vai a argon2id na carga e o segredo vai cifrado (AES-256-GCM) ao cofre do cliente. O abridor (dm-snapshot) exige --privileged só na execução que abre o arquivo.
FROM firebirdsql/firebird:3.0.14-jammy
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip dmsetup util-linux coreutils \
 && pip3 install --no-cache-dir firebird-driver==1.10.10 PyMySQL==1.1.1 argon2-cffi==23.1.0 cryptography==43.0.3 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV FIREBIRD=/opt/firebird \
    LD_LIBRARY_PATH=/opt/firebird/lib \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    ISC_USER=SYSDBA
WORKDIR /app
COPY sante_conector /app/sante_conector
COPY testes /app/testes
COPY mapa /app/mapa
ENTRYPOINT ["python3", "-s", "-m", "sante_conector.cli"]
