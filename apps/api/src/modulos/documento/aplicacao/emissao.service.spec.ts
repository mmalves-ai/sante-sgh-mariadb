// Ordem da emissão (revisão do M09): reserva da linha antes de guardar o arquivo, confirmação com o id dele depois;
// falha da gravação não deixa arquivo nem emissão válida; duas reemissões ao mesmo tempo ganham vias diferentes.
// Gotenberg é dublê e a porta de arquivos é a de memória (o fluxo real está em documento.int.spec.ts). Massa sintética.
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistroEmissoesMemoria } from '../infra/registro.js';
import { ArmazemArquivosMemoria } from '../infra/arquivos.js';
import { EmissaoService } from './emissao.service.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');

class ArmazemEspiao extends ArmazemArquivosMemoria {
  falharGravacao = false;
  ordem: string[] = [];
  override async guardar(...a: Parameters<ArmazemArquivosMemoria['guardar']>) {
    this.ordem.push(`guardar:${a[1].chaveIdempotencia}`);
    if (this.falharGravacao) throw new Error('disco fora');
    return super.guardar(...a);
  }
}

class RegistroEspiao extends RegistroEmissoesMemoria {
  reservadas = 0;
  constructor(private readonly ordem: string[]) {
    super();
  }
  override async reservar(e: Parameters<RegistroEmissoesMemoria['reservar']>[0]) {
    this.ordem.push(`reservar:${e.chaveObjeto}`);
    await super.reservar(e);
    // Como o registro do banco: o id da linha da emissão, para o vínculo do arquivo.
    return ++this.reservadas;
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

const ctxTeste = { cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 't' };
let armazem: ArmazemEspiao;
let registro: RegistroEspiao;
let servico: EmissaoService;

beforeEach(() => {
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new TextEncoder().encode(`%PDF-1.7 prova ${++n}`), { status: 200 })),
  );
  armazem = new ArmazemEspiao();
  registro = new RegistroEspiao(armazem.ordem);
  servico = new EmissaoService({
    armazem,
    cliente: 'teste',
    gotenbergUrl: 'http://127.0.0.1:3318',
    registro,
    retencao: { imutavel: false, duracaoMs: 60_000 },
    idEstabelecimento: async (codigo: string) => {
      if (codigo !== 'zz')
        throw new Error('Estabelecimento fora do mapa do cliente: o arquivo não foi guardado.');
      return 42;
    },
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
      armazem,
      cliente: 'teste',
      gotenbergUrl: 'http://127.0.0.1:3318',
      registro,
      retencao: { imutavel: false, duracaoMs: 60_000 },
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
  it('reserva antes de guardar e confirma com o arquivo; o PDF é lido pelo arquivo do registro', async () => {
    const e = await servico.emitir(pedido);
    expect(armazem.ordem).toEqual([`reservar:${e.emissao.chaveObjeto}`, `guardar:documento-${e.emissao.id}`]);
    expect(e.emissao.versaoS3).toBe('1');
    expect(await registro.porId(e.emissao.id)).toMatchObject({ versaoS3: '1' });
    expect(new TextDecoder().decode(await servico.lerPdf(e.emissao))).toMatch(/^%PDF-/);
    const meta = await armazem.metadado(
      { cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 't' },
      1,
    );
    expect(meta).toMatchObject({
      finalidade: 'documento_emitido',
      tipoMime: 'application/pdf',
      imutavel: false,
    });
    expect(meta!.retencaoAte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gravação falhou: nenhum arquivo e a reserva não vale como emissão (nem no QR)', async () => {
    armazem.falharGravacao = true;
    await expect(servico.emitir(pedido)).rejects.toThrow('disco fora');
    expect(armazem.tamanho).toBe(0);
    const reservaChave = armazem.ordem[0]!.replace('reservar:', '');
    expect(reservaChave).toMatch(/via-1\.pdf$/);
    const id = reservaChave.split('/')[4]!;
    expect(await registro.porId(id)).toBeNull();
  });

  it('o PDF emitido fica ligado à emissão e ao estabelecimento (nunca arquivo órfão)', async () => {
    const e = await servico.emitir({ ...pedido, usuario: 5 });
    const meta = await armazem.metadado(ctxTeste, Number(e.versaoS3));
    expect(meta).toMatchObject({ estabelecimento: 42, entidade: 'emissao_documento', entidadeId: 1 });
    expect(meta?.chave).toMatch(/^sistema\/42\//);
  });

  it('estabelecimento fora do mapa do cliente: recusa sem guardar arquivo', async () => {
    await expect(servico.emitir({ ...pedido, estabelecimento: 'yy' })).rejects.toThrow(/fora do mapa/);
    expect(armazem.tamanho).toBe(0);
    await expect(servico.gravarAssinado('rede-teste', 'yy', 7, new Uint8Array([1]))).rejects.toThrow(
      /fora do mapa/,
    );
  });

  it('arquivo que não confere com o hash da emissão é recusado (nunca conteúdo errado)', async () => {
    const e = await servico.emitir(pedido);
    await expect(servico.lerPdf({ ...e.emissao, sha256: '0'.repeat(64) })).rejects.toThrow(/não confere/);
    await expect(servico.lerPdf({ ...e.emissao, versaoS3: 'x' })).rejects.toThrow(/sem arquivo/);
  });

  it('PDF assinado: arquivo novo com a guarda dos documentos, lido de volta pelo id', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 assinado');
    const g = await servico.gravarAssinado('rede-teste', 'zz', 7, pdf, 5);
    expect(g.chave).toMatch(/^sistema\/42\/\d{4}\/\d{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
    const meta = await armazem.metadado(ctxTeste, Number(g.versao));
    expect(meta).toMatchObject({ estabelecimento: 42, entidade: 'assinatura_icp', entidadeId: 7 });
    expect(new TextDecoder().decode(await servico.lerObjeto(g.chave, g.versao))).toBe('%PDF-1.7 assinado');
    await expect(servico.gravarAssinado('Rede Teste', 'zz', 7, pdf)).rejects.toThrow(/inválido/);
  });

  it('duas reemissões ao mesmo tempo: vias 2 e 3, sem repetir', async () => {
    const original = await servico.emitir(pedido);
    const [a, b, c] = await Promise.all([
      servico.segundaVia(original.emissao.id, 'Extravio do original', pedido),
      servico.segundaVia(original.emissao.id, 'Pedido da família', pedido),
      servico.segundaVia(original.emissao.id, 'Pedido do convênio', pedido),
    ]);
    expect([a!.emissao.via, b!.emissao.via, c!.emissao.via].sort()).toEqual([2, 3, 4]);
    // Cada via guardou um arquivo só (quem perdeu a via não guardou nada antes de tentar a próxima).
    expect(armazem.ordem.filter((x) => x.startsWith('guardar:'))).toHaveLength(4);
    expect(armazem.tamanho).toBe(4);
  });
});
