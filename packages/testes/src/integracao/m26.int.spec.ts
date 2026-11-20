// SADT sobre a cópia (ficha do M26, seção 10), sob a trava da cópia; as gravações sempre em transação desfeita:
//   - as leituras de cada tela no último dia de movimento do laboratório e da imagem (READ ONLY, só contagens e tempos);
//   - o fluxo do laboratório pelo executor: lançamento no setor, digitação, liberação com faixa crítica cadastrada (o
//     aviso na mesma transação), retificação com o motivo (a versão anterior guardada) e a vigia achando a liberação;
//   - a amostra coletada (código único) e a passagem de estado conferida pelo estado relido;
//   - o portal: o protocolo do paciente, os laudos liberados do atendimento e a visualização registrada como o portal do
//     outro sistema grava (data, fuso e IP).
// Massa sintética marcada; saída só com contagens e códigos (nenhum nome, nenhum valor de linha).
import {
  amostrasDoDia,
  apoioSadt,
  avisosCriticos,
  conferenciaDoExame,
  examesDoSetor,
  filaDeLiberacao,
  indicadoresSadt,
  laudoParaEmitir,
  laudosPortalDoPaciente,
  liberacaoVigente,
  liberadosComCriticoDesde,
  listaDeColeta,
  mapaDeTrabalho,
  orcamentos,
  parametrosDoSetor,
  requisicoesDoDia,
  resultadoParaDigitacao,
  valoresCriticos,
  autocadastrosPortal,
  ultimoDiaDoLaboratorio,
  vinculosDoLogin,
} from '@sgh/legado';
import { lerExameSadt, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  atendimentoComContaSadt,
  exameParametrizadoDoLaboratorio,
  estadoDoSadtPorFora,
  type EstadoSadtPorFora,
  gravacaoDoOutroSistemaNoExame,
  liberacaoImpossivelDoOutroSistema,
  prestadorELocalDoAto,
  profissionalComCbo,
} from '../massa/reproducao-sadt.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const m = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

describe.skipIf(!PODE_ESCREVER)('SADT na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras das telas no último dia de movimento (READ ONLY, só contagens e tempos)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const dia = await ultimoDiaDoLaboratorio(l);
      const ms: Record<string, number> = {};
      const medir = async <T>(nome: string, fn: () => Promise<T>): Promise<T> => {
        const t0 = Date.now();
        const x = await fn();
        ms[nome] = Date.now() - t0;
        return x;
      };
      const lab = await medir('setor', () =>
        examesDoSetor(l, a.cod, { setor: 'laboratorio', inicio: dia, fim: dia }),
      );
      const img = await medir('imagem', () =>
        examesDoSetor(l, a.cod, { setor: 'imagem', inicio: `${dia.slice(0, 7)}-01`, fim: dia }),
      );
      const coleta = await medir('coleta', () => listaDeColeta(l, a.cod, { inicio: dia, fim: dia }));
      const mapa = await medir('mapa', () =>
        mapaDeTrabalho(l, a.cod, { setor: 'laboratorio', inicio: dia, fim: dia }),
      );
      const fila = await medir('liberacao', () =>
        filaDeLiberacao(l, a.cod, { setor: 'laboratorio', inicio: dia, fim: dia }),
      );
      const liberado = (
        await examesDoSetor(l, a.cod, { setor: 'laboratorio', inicio: dia, fim: dia, situacao: 'liberados' })
      ).itens[0];
      const digitacao = liberado
        ? await medir('digitacao', () => resultadoParaDigitacao(l, a.cod, liberado.id))
        : null;
      const conferencia = liberado ? await conferenciaDoExame(l, a.cod, liberado.id) : null;
      const vigente = liberado ? await liberacaoVigente(l, liberado.id) : null;
      const laudo = liberado ? await laudoParaEmitir(l, a.cod, [liberado.id]) : null;
      const portal = liberado?.paciente.id
        ? await laudosPortalDoPaciente(l, {
            paciente: liberado.paciente.id,
            reg: liberado.chave.reg,
            atos: [15],
          })
        : null;
      const vigia = await medir('vigia', () =>
        liberadosComCriticoDesde(l, a.cod, { desde: new Date(Date.parse(`${dia}T00:00:00`)), hoje: dia }),
      );
      const ind = await medir('indicadores', () =>
        indicadoresSadt(l, {
          inicio: `${dia.slice(0, 7)}-01`,
          fim: dia,
          agora: new Date(),
          hospital: a.cod,
        }),
      );
      const req = await medir('requisicoes', () => requisicoesDoDia(l, { data: dia }));
      const orc = await medir('orcamentos', () =>
        orcamentos(l, a.cod, { inicio: '2020-01-01', fim: dia, hoje: dia, validadeDias: 30 }),
      );
      const apoio = await medir('apoio', () => apoioSadt(l, 'laboratorio'));
      const parametros = await parametrosDoSetor(l, 'laboratorio', liberado ? 'SGH.TESTE' : 'SGH.TESTE');
      const criticos = await valoresCriticos(l, a.cod);
      const avisos = await avisosCriticos(l, a.cod, { inicio: dia, fim: dia });
      const amostras = await amostrasDoDia(l, a.cod, { data: dia });
      const auto = await autocadastrosPortal(l, a.cod, { desde: '2026-01-01' });
      const vinculos = await vinculosDoLogin(l, 'SGH.TESTE');
      return {
        dia: dia.length === 10,
        lab: lab.itens.length,
        labTodos: lab.contagens['todos'] ?? 0,
        imagem: img.itens.length,
        grupos: coleta.grupos.length,
        bancadas: mapa.bancadas.length,
        aLiberar: fila.itens.length,
        digitacaoComElementos: (digitacao?.elementos.length ?? 0) > 0,
        bloqueado: digitacao?.bloqueado ?? null,
        conferenciaComValores: (conferencia?.valores.length ?? 0) > 0,
        vigente: vigente !== null,
        laudoComExame: laudo?.exames.length ?? 0,
        portal: portal?.laudos.length ?? 0,
        vigia: vigia.length,
        indicadores: ind.linhas.length,
        porDia: ind.porDia.length,
        requisicoes: req.itens.length,
        orcamentos: orc.itens.length,
        prestadores: apoio.prestadores.length,
        exames: apoio.exames.length,
        parametrosOcultos: parametros.ocultos.length,
        criticos: criticos.length,
        avisos: avisos.length,
        amostras: amostras.itens.length,
        autocadastros: auto.length,
        vinculos: vinculos.length,
        ms,
      };
    });
    expect(r.dia).toBe(true);
    expect(r.lab).toBeGreaterThan(0);
    expect(r.digitacaoComElementos).toBe(true);
    expect(r.bloqueado).toBe(true);
    expect(r.conferenciaComValores).toBe(true);
    expect(r.laudoComExame).toBe(1);
    expect(r.indicadores).toBeGreaterThan(0);
    expect(r.exames).toBeGreaterThan(0);
    // Os segredos do parâmetro do laboratório nunca são lidos (só o nome do campo).
    expect(r.parametrosOcultos).toBeGreaterThan(0);
    for (const t of Object.values(r.ms)) expect(t).toBeLessThan(20_000);
    console.log(
      `[${a.cod}] leituras do SADT: ${m(r.lab)} exames do laboratório no dia (${m(r.labTodos)} no total), ${m(r.imagem)} de imagem no mês, ${m(r.grupos)} grupos de coleta, ${m(r.bancadas)} bancadas, ${m(r.aLiberar)} a liberar, ${m(r.portal)} laudos no portal do atendimento, ${m(r.vigia)} liberações com faixa crítica, ${m(r.indicadores)} linhas de indicadores, ${m(r.requisicoes)} requisições, ${m(r.orcamentos)} orçamentos, ${m(r.prestadores)} prestadores, ${m(r.autocadastros)} autocadastros; tempos ${JSON.stringify(r.ms)}`,
    );
  });

  // Lente "contagens iguais após ROLLBACK": o estado antes dos testes que gravam e depois deles (o último teste).
  let antesDasGravacoes: EstadoSadtPorFora | null = null;
  it('estado do SADT antes das gravações (contagens, maiores IDs e generators)', async () => {
    antesDasGravacoes = await a.nucleo.lerSomente(ctx(a), (l) => estadoDoSadtPorFora(l));
    expect(Object.keys(antesDasGravacoes.tabelas).length).toBeGreaterThan(0);
  });

  it('TAT sem sentinela: a liberação impossível (ano 5202) conta como liberada, mas fica fora da média', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const tec = await profissionalComCbo(e, ['2212', '2234', '225335']);
      const at = await atendimentoComContaSadt(e, 'E');
      const exame = await exameParametrizadoDoLaboratorio(e);
      const pl = await prestadorELocalDoAto(e, 15);
      const r = await a.executor.executar(
        operacao('sadt.lancarExame'),
        a.cod,
        {
          atendimento: at.id,
          ato: 15,
          atend: 'E',
          itens: [{ exame, urgente: false }],
          executante: tec.cbo,
          prestador: pl.prestador,
          local: pl.local,
          solicitante: tec.cbo,
          retratos: at.retratos,
          confirmarAlertas: true,
          repeticaoMinimaHoras: 0,
        },
        ctxOperacao(a, tec.login),
        { escritor: e },
      );
      const id = num(r.resultado['primeiro']);
      const lido = await lerExameSadt(e, id);
      const dia = lido!.chave.data;
      const ler = () =>
        indicadoresSadt(e, {
          inicio: dia,
          fim: dia,
          setor: 'laboratorio',
          agora: new Date(),
          hospital: a.cod,
        });
      const soma = (x: Awaited<ReturnType<typeof ler>>, k: 'liberados' | 'comMarcas') =>
        x.linhas.reduce((n, l) => n + l[k], 0);
      const antes = await ler();
      await liberacaoImpossivelDoOutroSistema(e, id);
      const depois = await ler();
      expect(soma(depois, 'liberados')).toBe(soma(antes, 'liberados') + 1);
      expect(soma(depois, 'comMarcas')).toBe(soma(antes, 'comMarcas'));
      for (const l of depois.linhas) expect(l.semMarcas).toBe(l.liberados - l.comMarcas);
    });
  });

  it('disputa pela chave do exame: a gravação do outro sistema depois da leitura recusa a digitação (conflito de versão)', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const tec = await profissionalComCbo(e, ['2212', '2234', '225335']);
      const at = await atendimentoComContaSadt(e, 'E');
      const exame = await exameParametrizadoDoLaboratorio(e);
      const pl = await prestadorELocalDoAto(e, 15);
      const r = await a.executor.executar(
        operacao('sadt.lancarExame'),
        a.cod,
        {
          atendimento: at.id,
          ato: 15,
          atend: 'E',
          itens: [{ exame, urgente: false }],
          executante: tec.cbo,
          prestador: pl.prestador,
          local: pl.local,
          solicitante: tec.cbo,
          retratos: at.retratos,
          confirmarAlertas: true,
          repeticaoMinimaHoras: 0,
        },
        ctxOperacao(a, tec.login),
        { escritor: e },
      );
      const id = num(r.resultado['primeiro']);
      // A tela do novo leu o exame; o técnico do outro sistema grava antes, no mesmo segundo (o gatilho troca o
      // carimbo; a conferência compara o carimbo inteiro, com a fração do segundo).
      const lido = await lerExameSadt(e, id);
      await gravacaoDoOutroSistemaNoExame(e, id);
      // A tela que manda o carimbo nulo de um exame carimbado também é recusada (não pula a conferência).
      const nula = await a.executor
        .executar(
          operacao('sadt.registrarResultado'),
          a.cod,
          {
            exame: { id, chave: lido!.chave, versao: null },
            elementos: [{ elemento: 0, numerico: 4.4, alfa: null, absoluta: null }],
          },
          ctxOperacao(a, tec.login),
          { escritor: e },
        )
        .then(
          () => 'gravou',
          (x: { problema?: { codigo?: string } }) => x.problema?.codigo ?? 'outro',
        );
      expect(nula).toBe('conflito-versao');
      const recusa = await a.executor
        .executar(
          operacao('sadt.registrarResultado'),
          a.cod,
          {
            exame: { id, chave: lido!.chave, versao: lido!.versao },
            elementos: [{ elemento: 0, numerico: 4.4, alfa: null, absoluta: null }],
          },
          ctxOperacao(a, tec.login),
          { escritor: e },
        )
        .then(
          () => 'gravou',
          (x: { problema?: { codigo?: string } }) => x.problema?.codigo ?? 'outro',
        );
      expect(recusa).toBe('conflito-versao');
      // Relido o exame, a digitação grava e a prova confere o resultado e a liberação do gatilho.
      const relido = await lerExameSadt(e, id);
      const ok = await a.executor.executar(
        operacao('sadt.registrarResultado'),
        a.cod,
        {
          exame: { id, chave: relido!.chave, versao: relido!.versao },
          elementos: [{ elemento: 0, numerico: 4.4, alfa: null, absoluta: null }],
        },
        ctxOperacao(a, tec.login),
        { escritor: e },
      );
      expect(num(ok.resultado['resultados'])).toBe(1);
    });
  });

  it('depois do ROLLBACK: as tabelas voltam iguais; os generators só avançam (registrado)', async () => {
    expect(antesDasGravacoes).not.toBeNull();
    const antes = antesDasGravacoes!;
    const apos = await a.nucleo.lerSomente(ctx(a), (l) => estadoDoSadtPorFora(l));
    expect(apos.tabelas).toEqual(antes.tabelas);
    const avancaram: string[] = [];
    for (const [g, v] of Object.entries(apos.generators)) {
      expect(v).toBeGreaterThanOrEqual(antes.generators[g] ?? 0);
      if (v > (antes.generators[g] ?? 0)) avancaram.push(`${g} +${v - (antes.generators[g] ?? 0)}`);
    }
    console.log(
      `[${a.cod}] SADT desfeito: ${Object.keys(antes.tabelas).filter((k) => k.startsWith('linhas:')).length} tabela(s) iguais depois do ROLLBACK; generators que avançaram (esperado: os do gatilho e as reservas do executor não voltam): ${avancaram.join(', ') || 'nenhum'}`,
    );
  });
});
