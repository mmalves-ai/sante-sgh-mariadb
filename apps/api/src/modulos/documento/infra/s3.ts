// Cliente S3 mínimo do spike (ADR 0015, armazenamento com Object Lock): bucket com versionamento e
// Object Lock, gravação com retenção (COMPLIANCE em homologação e produção; GOVERNANCE curto no dev),
// leitura, cabeçalho e listagem de versões. Assinatura AWS SigV4 quando há credencial (S3_ACESSO e
// S3_SEGREDO); no dev em loopback, o S3 do Compose aceita sem credencial. Só endereços conferidos pela
// trava de saídas (loopback fora de produção). Nada de segredo em log.
import { createHash, createHmac } from 'node:crypto';

export interface ConfigS3 {
  readonly endpoint: string;
  readonly regiao: string;
  readonly acesso?: string | undefined;
  readonly segredo?: string | undefined;
}

export type ModoRetencao = 'GOVERNANCE' | 'COMPLIANCE';

export class ErroS3 extends Error {
  override readonly name = 'ErroS3';
  readonly status: number;
  readonly codigo: string | null;
  constructor(status: number, codigo: string | null, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const sha256 = (dados: string | Uint8Array) => createHash('sha256').update(dados).digest('hex');
const hmac = (chave: string | Buffer, texto: string) => createHmac('sha256', chave).update(texto).digest();

function codificar(segmento: string): string {
  return encodeURIComponent(segmento).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export class ClienteS3 {
  private readonly cfg: ConfigS3;
  constructor(cfg: ConfigS3) {
    this.cfg = cfg;
  }

  private async pedir(
    metodo: string,
    caminho: string,
    consulta: Record<string, string> = {},
    cabecalhos: Record<string, string> = {},
    corpo: Uint8Array | string = '',
  ): Promise<{ status: number; cabecalhos: Headers; corpo: Uint8Array }> {
    const base = new URL(this.cfg.endpoint);
    const caminhoCodificado = caminho
      .split('/')
      .map((s) => codificar(s))
      .join('/');
    const qs = Object.keys(consulta)
      .sort()
      .map((k) => `${codificar(k)}=${codificar(consulta[k] ?? '')}`)
      .join('&');
    const url = `${base.origin}${caminhoCodificado}${qs ? `?${qs}` : ''}`;
    const bytes = typeof corpo === 'string' ? new TextEncoder().encode(corpo) : corpo;
    const h: Record<string, string> = {
      ...cabecalhos,
      host: base.host,
      'x-amz-content-sha256': sha256(bytes),
    };
    if (bytes.length > 0 && !h['content-md5']) {
      h['content-md5'] = createHash('md5').update(bytes).digest('base64');
    }
    if (this.cfg.acesso && this.cfg.segredo) {
      const agora = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
      const dia = agora.slice(0, 8);
      h['x-amz-date'] = agora;
      const nomes = Object.keys(h)
        .map((k) => k.toLowerCase())
        .sort();
      const canonico = [
        metodo,
        caminhoCodificado,
        qs,
        nomes
          .map((n) => `${n}:${String(h[Object.keys(h).find((k) => k.toLowerCase() === n)!]).trim()}\n`)
          .join(''),
        nomes.join(';'),
        h['x-amz-content-sha256'],
      ].join('\n');
      const escopo = `${dia}/${this.cfg.regiao}/s3/aws4_request`;
      const paraAssinar = ['AWS4-HMAC-SHA256', agora, escopo, sha256(canonico)].join('\n');
      const chave = hmac(
        hmac(hmac(hmac(`AWS4${this.cfg.segredo}`, dia), this.cfg.regiao), 's3'),
        'aws4_request',
      );
      const assinatura = createHmac('sha256', chave).update(paraAssinar).digest('hex');
      h['authorization'] =
        `AWS4-HMAC-SHA256 Credential=${this.cfg.acesso}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}`;
    }
    delete h['host'];
    const r = await fetch(url, {
      method: metodo,
      headers: h,
      body: bytes.length ? (bytes as Uint8Array<ArrayBuffer>) : null,
    });
    const resposta = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, cabecalhos: r.headers, corpo: resposta };
  }

  private static falha(r: { status: number; corpo: Uint8Array }, acao: string): never {
    const texto = new TextDecoder().decode(r.corpo);
    const codigo = /<Code>([^<]+)<\/Code>/.exec(texto)?.[1] ?? null;
    throw new ErroS3(r.status, codigo, `S3 recusou ${acao} (${r.status}${codigo ? ` ${codigo}` : ''}).`);
  }

  /** Cria o bucket com Object Lock (e, com ele, versionamento). Idempotente. */
  async criarBucketComTrava(bucket: string): Promise<void> {
    const r = await this.pedir('PUT', `/${bucket}`, {}, { 'x-amz-bucket-object-lock-enabled': 'true' });
    if (r.status === 200) return;
    const texto = new TextDecoder().decode(r.corpo);
    if (r.status === 409 && /BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(texto)) return;
    ClienteS3.falha(r, 'criar o bucket');
  }

  async travaDoBucket(bucket: string): Promise<{ habilitada: boolean; versionamento: boolean }> {
    const lock = await this.pedir('GET', `/${bucket}`, { 'object-lock': '' });
    const ver = await this.pedir('GET', `/${bucket}`, { versioning: '' });
    const t = (x: Uint8Array) => new TextDecoder().decode(x);
    return {
      habilitada:
        lock.status === 200 && /<ObjectLockEnabled>Enabled<\/ObjectLockEnabled>/.test(t(lock.corpo)),
      versionamento: ver.status === 200 && /<Status>Enabled<\/Status>/.test(t(ver.corpo)),
    };
  }

  async existe(bucket: string, chave: string): Promise<boolean> {
    const r = await this.pedir('HEAD', `/${bucket}/${chave}`);
    if (r.status === 200) return true;
    if (r.status === 404) return false;
    ClienteS3.falha(r, 'conferir o objeto');
  }

  /** Grava com retenção até a data dada; devolve a versão criada. */
  async gravarComRetencao(
    bucket: string,
    chave: string,
    corpo: Uint8Array,
    tipo: string,
    modo: ModoRetencao,
    ate: Date,
  ): Promise<{ versao: string | null }> {
    const r = await this.pedir(
      'PUT',
      `/${bucket}/${chave}`,
      {},
      {
        'content-type': tipo,
        'x-amz-object-lock-mode': modo,
        'x-amz-object-lock-retain-until-date': ate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
      corpo,
    );
    if (r.status !== 200) ClienteS3.falha(r, 'gravar o objeto');
    return { versao: r.cabecalhos.get('x-amz-version-id') };
  }

  /** Gravação sem retenção: só para provar, no teste, que a versão protegida continua lá. */
  async gravarSemRetencao(
    bucket: string,
    chave: string,
    corpo: Uint8Array,
  ): Promise<{ versao: string | null }> {
    const r = await this.pedir(
      'PUT',
      `/${bucket}/${chave}`,
      {},
      { 'content-type': 'application/octet-stream' },
      corpo,
    );
    if (r.status !== 200) ClienteS3.falha(r, 'gravar o objeto');
    return { versao: r.cabecalhos.get('x-amz-version-id') };
  }

  async ler(bucket: string, chave: string, versao?: string): Promise<Uint8Array> {
    const r = await this.pedir('GET', `/${bucket}/${chave}`, versao ? { versionId: versao } : {});
    if (r.status !== 200) ClienteS3.falha(r, 'ler o objeto');
    return r.corpo;
  }

  async retencao(
    bucket: string,
    chave: string,
    versao: string,
  ): Promise<{ modo: string | null; ate: string | null }> {
    const r = await this.pedir('GET', `/${bucket}/${chave}`, { retention: '', versionId: versao });
    if (r.status !== 200) ClienteS3.falha(r, 'ler a retenção');
    const t = new TextDecoder().decode(r.corpo);
    return {
      modo: /<Mode>([^<]+)</.exec(t)?.[1] ?? null,
      ate: /<RetainUntilDate>([^<]+)</.exec(t)?.[1] ?? null,
    };
  }

  /** Tenta apagar uma versão (o Object Lock tem de recusar enquanto houver retenção). */
  async apagarVersao(
    bucket: string,
    chave: string,
    versao: string,
    ignorarGovernance = false,
  ): Promise<void> {
    const r = await this.pedir(
      'DELETE',
      `/${bucket}/${chave}`,
      { versionId: versao },
      ignorarGovernance ? { 'x-amz-bypass-governance-retention': 'true' } : {},
    );
    if (r.status !== 204 && r.status !== 200) ClienteS3.falha(r, 'apagar a versão');
  }

  /**
   * Fixa a retenção da versão atual (a passagem de GOVERNANCE curta para COMPLIANCE depois do COMMIT): leva o
   * cabeçalho de desvio da GOVERNANCE, que a troca de modo exige; o COMPLIANCE nunca se encurta.
   */
  async fixarRetencao(bucket: string, chave: string, modo: ModoRetencao, ate: Date): Promise<void> {
    const corpo =
      `<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>${modo}</Mode>` +
      `<RetainUntilDate>${ate.toISOString().replace(/\.\d{3}Z$/, 'Z')}</RetainUntilDate></Retention>`;
    const r = await this.pedir(
      'PUT',
      `/${bucket}/${chave}`,
      { retention: '' },
      { 'content-type': 'application/xml', 'x-amz-bypass-governance-retention': 'true' },
      corpo,
    );
    if (r.status !== 200) ClienteS3.falha(r, 'fixar a retenção');
  }

  /** Tenta encurtar a retenção de uma versão (COMPLIANCE tem de recusar). */
  async encurtarRetencao(
    bucket: string,
    chave: string,
    versao: string,
    modo: ModoRetencao,
    ate: Date,
  ): Promise<void> {
    const corpo =
      `<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>${modo}</Mode>` +
      `<RetainUntilDate>${ate.toISOString().replace(/\.\d{3}Z$/, 'Z')}</RetainUntilDate></Retention>`;
    const r = await this.pedir(
      'PUT',
      `/${bucket}/${chave}`,
      { retention: '', versionId: versao },
      { 'content-type': 'application/xml' },
      corpo,
    );
    if (r.status !== 200) ClienteS3.falha(r, 'mudar a retenção');
  }

  async versoes(bucket: string, prefixo: string): Promise<{ versao: string; atual: boolean }[]> {
    const r = await this.pedir('GET', `/${bucket}`, { versions: '', prefix: prefixo });
    if (r.status !== 200) ClienteS3.falha(r, 'listar versões');
    const t = new TextDecoder().decode(r.corpo);
    return [...t.matchAll(/<Version>([\s\S]*?)<\/Version>/g)].map((m) => ({
      versao: /<VersionId>([^<]+)</.exec(m[1]!)?.[1] ?? '',
      atual: /<IsLatest>true</.test(m[1]!),
    }));
  }
}
