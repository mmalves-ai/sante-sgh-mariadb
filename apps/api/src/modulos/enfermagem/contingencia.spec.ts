// M40, regra 6: o relatório de contingência do posto sobre a porta EM MEMÓRIA (massa sintética; nada conecta a banco)
// e um serviço de emissão de mentira (o PDF/A real é provado pela integração e pelo E2E, com o Gotenberg do Compose).
// A HTTP: pedido inválido 400, sem a permissão 403, com o serviço de emissão fora 503 (a mensagem manda imprimir a
// linha do tempo); a leitura vai à trilha com a unidade e as contagens. A geração de cada hora: só os postos do
// parâmetro, e cada geração na trilha como leitura do sistema.
import { resolve } from 'node:path';
import { fonteCatalogoArquivo } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import type { FonteDocumento } from '../documento/public-api.js';
import { GeracaoPorHora, postosDoParametro, ServicoContingencia } from './contingencia.js';
import { type AppEnfermagem, criarAppEnfermagem, RELOGIO_TESTE } from './enfermagem.spec-util.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const porta = () =>
  new PortaEnfermagemMemoria(
    fonteCatalogoArquivo(resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo')),
    { agora: () => new Date(RELOGIO_TESTE) },
  );
const c = { rede: 'r', hospital: 'aa' };

function emissaoFalsa() {
  const pedidos: { modelo: string; campos: readonly { rotulo: string; valor: string }[]; autor: string }[] =
    [];
  const fonte = {
    emissao: {
      emitir: (p: {
        modelo: string;
        campos: readonly { rotulo: string; valor: string }[];
        autor: string;
      }) => {
        pedidos.push(p);
        return Promise.resolve({
          emissao: { id: `doc-${pedidos.length}` },
          pdf: new TextEncoder().encode('%PDF-1.7 sintetico'),
        });
      },
      // O armazém relido pela emissão (a versão do registro): devolve o PDF com o id do documento.
      lerPdf: (e: { id: string }) => Promise.resolve(new TextEncoder().encode(`%PDF-1.7 relido ${e.id}`)),
    },
  } as unknown as FonteDocumento;
  return { fonte, pedidos };
}

describe('relatório de contingência do posto (serviço)', () => {
  it('lê o posto, monta os blocos por leito e emite o PDF pelo serviço de emissão', async () => {
    const { fonte, pedidos } = emissaoFalsa();
    const g = await new ServicoContingencia(porta(), fonte).gerar(c, {
      unidade: 'UTI',
      horas: 6,
      autor: 'SINT.ENF',
    });
    expect(g.resumo).toMatchObject({ unidade: 'UTI', pacientes: 3, documento: 'doc-1', cortado: false });
    expect(g.resumo.horarios).toBeGreaterThan(0);
    expect(new TextDecoder().decode(g.pdf)).toMatch(/^%PDF/);
    const p = pedidos[0]!;
    expect(p.modelo).toBe('contingencia-posto');
    expect(p.autor).toBe('SINT.ENF');
    const rotulos = p.campos.map((x) => x.rotulo);
    expect(rotulos.filter((r) => r.startsWith('Leito '))).toEqual([
      'Leito UTI-01',
      'Leito UTI-02',
      'Leito UTI-03',
    ]);
    expect(p.campos.find((x) => x.rotulo === 'Alergias')?.valor).toBe('ALERGIA SINTETICA');
    expect(rotulos).toEqual(
      expect.arrayContaining(['Prescrição vigente', 'Horários aprazados', 'Lista de problemas']),
    );
    expect(p.campos.find((x) => x.rotulo === 'Higienização em andamento')?.valor).toBe(
      'leito 99: Em execução',
    );
  });

  it('o último relatório do posto: nenhum antes da geração; depois, o da hora relido do armazém, por hospital', async () => {
    const { fonte } = emissaoFalsa();
    const trilha = new RegistradorTrilhaMemoria();
    const servico = new ServicoContingencia(porta(), fonte);
    expect(await servico.ultima(c, 'UTI')).toBeNull();
    const por = new GeracaoPorHora(
      servico,
      trilha,
      (_r, _h, chave) => Promise.resolve(chave === 'enfermagem.contingenciaPostos' ? 'UTI' : '4'),
      ['aa'],
      'r',
    );
    await por.ciclo();
    const u = await servico.ultima(c, 'UTI');
    expect(u?.resumo).toMatchObject({ unidade: 'UTI', documento: 'doc-1', pacientes: 3 });
    expect(new TextDecoder().decode(u!.pdf)).toBe('%PDF-1.7 relido doc-1');
    // A geração seguinte (tela ou hora) passa a ser a última; outro hospital não enxerga.
    await servico.gerar(c, { unidade: 'UTI', horas: 6, autor: 'SINT.ENF' });
    expect((await servico.ultima(c, 'UTI'))?.resumo.documento).toBe('doc-2');
    expect(await servico.ultima({ ...c, hospital: 'bb' }, 'UTI')).toBeNull();
  });

  it('sem o serviço de emissão: 503 com a saída pela linha do tempo', async () => {
    const e = (await new ServicoContingencia(porta(), null)
      .gerar(c, { unidade: 'UTI', horas: 6, autor: 'x' })
      .then(
        () => null,
        (x: unknown) => x,
      )) as { getStatus(): number; detalhe: string };
    expect(e.getStatus()).toBe(503);
    expect(e.detalhe).toMatch(/linha do tempo do turno/);
  });

  it('a geração de cada hora: só os postos do parâmetro; cada uma na trilha como leitura do sistema', async () => {
    expect(postosDoParametro(' UTI, CTI,,x y ')).toEqual(['UTI', 'CTI']);
    expect(postosDoParametro(null)).toEqual([]);
    const { fonte, pedidos } = emissaoFalsa();
    const trilha = new RegistradorTrilhaMemoria();
    const por = new GeracaoPorHora(
      new ServicoContingencia(porta(), fonte),
      trilha,
      (_r, hospital, chave) =>
        Promise.resolve(
          chave === 'enfermagem.contingenciaPostos' ? (hospital === 'aa' ? 'UTI,ENF1' : '') : '4',
        ),
      ['aa', 'bb'],
      'r',
    );
    const feitos = await por.ciclo();
    expect(feitos).toEqual([
      { hospital: 'aa', unidade: 'UTI', ok: true },
      { hospital: 'aa', unidade: 'ENF1', ok: true },
    ]);
    expect(pedidos.map((p) => p.autor)).toEqual(['sgh.api', 'sgh.api']);
    const ev = trilha.eventos.filter((e) => e.evento === 'enfermagem.contingencia.gerada');
    expect(ev.map((e) => e.chaveNaturalAlvo)).toEqual([
      expect.stringMatching(/^contingencia:UTI:3:\d+$/),
      expect.stringMatching(/^contingencia:ENF1:1:\d+$/),
    ]);
    expect(ev[0]).toMatchObject({ usuario: 'sgh.api', resultado: 'sucesso', idAlvo: 'doc-1' });
  });
});

describe('relatório de contingência do posto (HTTP)', { timeout: 30_000 }, () => {
  let a: AppEnfermagem;
  beforeAll(async () => {
    a = await criarAppEnfermagem();
  });
  afterAll(async () => {
    await a.fechar();
  });

  it('pedido inválido 400; sem a permissão de leitura da enfermagem 403', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.post(enf, '/enfermagem/contingencia', { unidade: "UTI'--" })).statusCode).toBe(400);
    expect((await a.post(enf, '/enfermagem/contingencia', { unidade: 'UTI', horas: 48 })).statusCode).toBe(
      400,
    );
    const rec = await a.entrar('SINT.RECEPCAO');
    expect((await a.post(rec, '/enfermagem/contingencia', { unidade: 'UTI' })).statusCode).toBe(403);
  });

  it('o último relatório do posto: unidade inválida 400; sem relatório gerado 404; sem a permissão 403', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.get(enf, "/enfermagem/contingencia/ultima?unidade=UTI'--")).statusCode).toBe(400);
    const r = await a.get(enf, '/enfermagem/contingencia/ultima?unidade=UTI');
    expect(r.statusCode).toBe(404);
    expect(r.body).toMatch(/gere um agora/);
    const rec = await a.entrar('SINT.RECEPCAO');
    expect((await a.get(rec, '/enfermagem/contingencia/ultima?unidade=UTI')).statusCode).toBe(403);
  });
});
