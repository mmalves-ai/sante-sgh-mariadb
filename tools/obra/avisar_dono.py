"""Aviso da obra ao dono por e-mail (Amazon SES, API v2), a partir de noreply@hal-ai.com.

uso: python3 -I tools/obra/avisar_dono.py --assunto "..." (--texto "..." | --arquivo F) [--para EMAIL]

Canal autorizado pelo dono em 2026-11-21 só para avisos da obra a ele mesmo (marcos, liberação para navegar).
Não é envio do produto: o produto segue a regra 6 do AGENTS.md (nenhuma mensagem externa fora de produção).
- As credenciais vêm de AWS_REGION, AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY do .env desta pasta. Elas são lidas na
  hora e nunca impressas nem copiadas.
- O destinatário padrão é DONO_EMAIL do .env ou, na falta dele, o endereço fixo abaixo.
- Conteúdo: só contagens e agregados (regra 5). Nunca dado de pessoa.
Só biblioteca padrão (assinatura SigV4 feita aqui), para não instalar nada na VM.
"""
import datetime
import hashlib
import hmac
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
REMETENTE = "noreply@hal-ai.com"
DONO_PADRAO = "mmalves@hal-ai.com"


def ler_env():
    env = {}
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in linha and not linha.lstrip().startswith("#"):
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _h(chave, msg):
    return hmac.new(chave, msg.encode("utf-8"), hashlib.sha256).digest()


def enviar(para, assunto, texto):
    env = ler_env()
    regiao, chave, segredo = env.get("AWS_REGION"), env.get("AWS_ACCESS_KEY_ID"), env.get("AWS_SECRET_ACCESS_KEY")
    if not (regiao and chave and segredo):
        raise SystemExit("faltam AWS_REGION, AWS_ACCESS_KEY_ID ou AWS_SECRET_ACCESS_KEY no .env")
    host = f"email.{regiao}.amazonaws.com"
    caminho = "/v2/email/outbound-emails"
    corpo = json.dumps({
        "FromEmailAddress": REMETENTE,
        "Destination": {"ToAddresses": [para]},
        "Content": {"Simple": {"Subject": {"Data": assunto, "Charset": "UTF-8"},
                               "Body": {"Text": {"Data": texto, "Charset": "UTF-8"}}}},
    }).encode("utf-8")
    agora = datetime.datetime.now(datetime.timezone.utc)
    amz, dia = agora.strftime("%Y%m%dT%H%M%SZ"), agora.strftime("%Y%m%d")
    hash_corpo = hashlib.sha256(corpo).hexdigest()
    cab = {"content-type": "application/json", "host": host, "x-amz-date": amz}
    assinados = ";".join(sorted(cab))
    canonico = "\n".join(["POST", caminho, "", "".join(f"{k}:{cab[k]}\n" for k in sorted(cab)), assinados, hash_corpo])
    escopo = f"{dia}/{regiao}/ses/aws4_request"
    a_assinar = "\n".join(["AWS4-HMAC-SHA256", amz, escopo, hashlib.sha256(canonico.encode()).hexdigest()])
    k = _h(_h(_h(_h(("AWS4" + segredo).encode(), dia), regiao), "ses"), "aws4_request")
    assinatura = hmac.new(k, a_assinar.encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(f"https://{host}{caminho}", data=corpo, method="POST", headers={
        "Content-Type": "application/json", "X-Amz-Date": amz,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={chave}/{escopo}, SignedHeaders={assinados}, Signature={assinatura}",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}").get("MessageId", "?")
    except urllib.error.HTTPError as e:
        # A mensagem de erro da AWS não traz a credencial; corta para não poluir o log.
        raise SystemExit(f"SES recusou: HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


def main():
    a = sys.argv[1:]
    pega = lambda n: a[a.index(n) + 1] if n in a else None
    assunto = pega("--assunto")
    texto = pega("--texto") or (Path(pega("--arquivo")).read_text(encoding="utf-8") if pega("--arquivo") else None)
    if not assunto or not texto:
        raise SystemExit(__doc__)
    para = pega("--para") or ler_env().get("DONO_EMAIL") or DONO_PADRAO
    print(f"enviado para {para}: MessageId {enviar(para, assunto, texto)}")


if __name__ == "__main__":
    main()
