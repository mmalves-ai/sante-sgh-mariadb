// Ordem da emissão (revisão do M09): reserva da linha antes do PUT no S3, confirmação com a versão depois;
// falha do PUT não deixa objeto nem emissão válida; duas reemissões ao mesmo tempo ganham vias diferentes.
// Gotenberg e S3 são dublês (o fluxo real está em documento.int.spec.ts). Massa sintética.
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistroEmissoesMemoria } from '../infra/registro.js';
import type { ClienteS3 } from '../infra/s3.js';
import { EmissaoService } from './emissao.service.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');

class S3Duble {
  readonly objetos = new Map<string, { versao: string; bytes: Uint8Array }[]>();
  falharPut = false;
  semVersao = false;
  ordem: string[] = [];
  async existe(_b: string, chave: string) {
    return this.objetos.has(chave);
  }
  async gravarComRetencao(_b: string, chave: string, bytes: Uint8Array) {
    this.ordem.push(`put:${chave}`);
    if (this.falharPut) throw new Error('S3 fora');
    const versoes = this.objetos.get(chave) ?? [];
    const versao = `v${versoes.length + 1}`;
    versoes.push({ versao, bytes });
    this.objetos.set(chave, versoes);
    return { versao: this.semVersao ? null : versao };
  }
  async ler(_b: string, chave: string, versao?: string) {
    const v = this.objetos.get(chave) ?? [];
    const achado = versao ? v.find((x) => x.versao === versao) : v[v.length - 1];
    if (!achado) throw new Error('sem objeto');
    return achado.bytes;
  }
}

class RegistroEspiao extends RegistroEmissoesMemoria {
  constructor(private readonly ordem: string[]) {
    super();
  }
  override async reservar(e: Parameters<RegistroEmissoesMemoria['reservar']>[0]) {
    this.ordem.push(`reservar:${e.chaveObjeto}`);
    return super.reservar(e);
  }
}

const pedido = {
  rede: 'rede-teste',
  estabelecimento: 'zz',
  modelo: 'prova',
  versaoModelo: '1',
  titulo: 'Documento de prova',
  origem: { tipo: 'sintetico', idLegado: 1 },
  campos: [{ rotulo: 'Paciente', valor: 'Paciente Fictício de Teste' }],
  autor: 'USUARIO_TESTE',
};

let s3: S3Duble;
let registro: RegistroEspiao;
let servico: EmissaoService;

beforeEach(() => {
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new TextEncoder().encode(`%PDF-1.7 prova ${++n}`), { status: 200 })),
  );
  s3 = new S3Duble();
  registro = new RegistroEspiao(s3.ordem);
  servico = new EmissaoService({
    s3: s3 as unknown as ClienteS3,
    bucket: 'b',
    gotenbergUrl: 'http://127.0.0.1:3318',
    registro,
    retencao: { modo: 'GOVERNANCE', duracaoMs: 60_000 },
    produto: 'Produto de Teste',
    baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
    nomeEstabelecimento: (c) => c,
    raiz,
  });
});
afterEach(() => vi.unstubAllGlobals());

async function htmlEnviado(): Promise<string> {
  const chamadas = (fetch as unknown as { mock: { calls: [string, { body: FormData }][] } }).mock.calls;
  const corpo = chamadas[chamadas.length - 1]![1].body;
  return (corpo.get('files') as Blob).text();
}

describe('SBIS-42: rodapé da certificação', () => {
  const comCertificado = (f: (h: string) => Promise<string | null>) =>
    new EmissaoService({
      s3: s3 as unknown as ClienteS3,
      bucket: 'b',
      gotenbergUrl: 'http://127.0.0.1:3318',
      registro,
      retencao: { modo: 'GOVERNANCE', duracaoMs: 60_000 },
      produto: 'Produto de Teste',
      baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
      nomeEstabelecimento: (c) => c,
      raiz,
      certificadoSbis: f,
    });

  it('sem certificado (ou sem a leitura), o rodapé não cita a certificação', async () => {
    await servico.emitir(pedido);
    expect(await htmlEnviado()).not.toContain('SBIS');
    await comCertificado(async () => null).emitir(pedido);
    expect(await htmlEnviado()).not.toContain('SBIS');
    await comCertificado(async () => {
      throw new Error('banco fora');
    }).emitir(pedido);
    expect(await htmlEnviado()).not.toContain('SBIS');
  });

  it('com o certificado vigente do estabelecimento, o rodapé traz o número', async () => {
    const pedidos: string[] = [];
    await comCertificado(async (h) => (pedidos.push(h), 'NGS2-0001')).emitir(pedido);
    expect(pedidos).toEqual(['zz']);
    expect(await htmlEnviado()).toContain('Sistema certificado SBIS nº NGS2-0001.');
  });
});

describe('emissão em duas etapas', () => {
  it('reserva antes do PUT e confirma com a versão; o PDF é lido pela versão do registro', async () => {
    const e = await servico.emitir(pedido);
    expect(s3.ordem).toEqual([`reservar:${e.emissao.chaveObjeto}`, `put:${e.emissao.chaveObjeto}`]);
    expect(e.emissao.versaoS3).toBe('v1');
    expect(await registro.porId(e.emissao.id)).toMatchObject({ versaoS3: 'v1' });
    // PUT de fora na mesma chave cria versão nova "mais recente": a leitura do registro não muda.
    await s3.gravarComRetencao('b', e.emissao.chaveObjeto, new TextEncoder().encode('adulterado'));
    expect(new TextDecoder().decode(await servico.lerPdf(e.emissao))).toMatch(/^%PDF-/);
  });

  it('PUT falhou: nenhum objeto no S3 e a reserva não vale como emissão (nem no QR)', async () => {
    s3.falharPut = true;
    await expect(servico.emitir(pedido)).rejects.toThrow('S3 fora');
    expect(s3.objetos.size).toBe(0);
    const reservaChave = s3.ordem[0]!.replace('reservar:', '');
    expect(reservaChave).toMatch(/via-1\.pdf$/);
    const id = reservaChave.split('/')[4]!;
    expect(await registro.porId(id)).toBeNull();
  });

  it('S3 sem versão (versionamento desligado) é recusado', async () => {
    s3.semVersao = true;
    await expect(servico.emitir(pedido)).rejects.toThrow(/versão/);
  });

  it('duas reemissões ao mesmo tempo: vias 2 e 3, sem repetir', async () => {
    const original = await servico.emitir(pedido);
    const [a, b, c] = await Promise.all([
      servico.segundaVia(original.emissao.id, 'Extravio do original', pedido),
      servico.segundaVia(original.emissao.id, 'Pedido da família', pedido),
      servico.segundaVia(original.emissao.id, 'Pedido do convênio', pedido),
    ]);
    expect([a!.emissao.via, b!.emissao.via, c!.emissao.via].sort()).toEqual([2, 3, 4]);
    // Cada via gravou um objeto só (quem perdeu a via não gravou nada antes de tentar a próxima).
    expect([...s3.objetos.values()].every((v) => v.length === 1)).toBe(true);
    expect(s3.objetos.size).toBe(4);
  });
});
