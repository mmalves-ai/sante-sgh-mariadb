// Etapa 5 do M45 sobre a cópia (ficha, seções 4, 9 e 10; regras 10, 11, 12 e 13), sempre em transação desfeita (ou em
// leitura) e sob a trava da cópia:
//   - as leituras da nutrição e do mapa de dietas no tempo-alvo proposto (pacientes a triar: 200 / p95 < 500 ms; mapa
//     por unidade e refeição: 300 / p95 < 1 s; terapia: 50 / p95 < 1 s), com o mapa montado pelo domínio sobre a
//     prescrição real (só contagens saem);
//   - jejum da agenda (regra 11; `jejum-agenda`): a cirurgia agendada de uma internação, lida pela janela de início, põe
//     a refeição das horas antes em jejum de cirurgia;
//   - dieta prescrita sobre a de outro profissional: a nutricionista prescreve a dieta enteral pela receita do M24 (o
//     executor), a dieta aparece na terapia (com a categoria de quem prescreveu) e no mapa, o médico vê a dieta de outro
//     profissional ativa, e a meta da EMTN fica ligada ao detalhe da dieta (SGH_), tudo desfeito;
//   - o serviço social com o corpus CP1252 no parecer e a barreira social do NIR na mesma transação: o parecer volta
//     igual e só na própria tabela (nunca na trilha); o monitoramento mostra só tabelas SGH_ (social.autorizacao: o
//     sigilo é aplicado sobre o que foi lido).
// Saída só com contagens, códigos e tempos (nenhum nome).
import { condicaoLoginDoProfissional } from '@sgh/legado';
import { CORPUS_CP1252 } from '@sgh/contratos';
import {
  comSigiloSocial,
  contagensDoMapa,
  instantesDaRefeicao,
  jejumAgendado,
  linhaDoMapa,
  refeicoesComCorte,
  situacaoTriagem,
  PRAZOS_TRIAGEM_PADRAO,
  calcularMeta,
} from '@sgh/dominio-pep';
import {
  acompanhantesVigentes,
  alergiasAlimentaresDosPacientes,
  checagensDasDietas,
  cirurgiasNaJanela,
  classesDaLinhaSgh,
  dietaAtivaDeOutro,
  dietasEnteraisDoAtendimento,
  escritasDaTransacao,
  examesNaJanela,
  fichasNutricionais,
  gravarTrilha,
  instanteCivil,
  internadosParaNutricao,
  internacoesComMeta,
  itensDietaDosAtendimentos,
  operacao,
  refeicoesDoCadastro,
  registrarAvaliacaoSocialSgh,
  registrarMetaTerapiaSgh,
  registrosSociaisDaInternacao,
  retratoDoMapa,
  somenteSgh,
  terapiaDaInternacao,
  triagensDasInternacoes,
  vinculosCategoriaDoLogin,
  cadastrosProfissionaisDoLogin,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  atendimentoAberto,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  prescritorDaCopia,
} from '../massa/reproducao-prescricao.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const CORPUS = CORPUS_CP1252.filter((t) => !t.includes('₂'));
const p2 = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

async function cronometrar<T>(fn: () => Promise<T>, vezes = 5): Promise<{ r: T; maxMs: number }> {
  let r!: T;
  let max = 0;
  for (let i = 0; i < vezes; i++) {
    const t0 = performance.now();
    r = await fn();
    max = Math.max(max, performance.now() - t0);
  }
  return { r, maxMs: Math.round(max) };
}

describe.skipIf(!PODE_ESCREVER)('nutrição, mapa de dietas e serviço social na cópia (M45, etapa 5)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /**
   * O retrato das tabelas que as gravações tocam, FORA da transação desfeita (correção da revisão: as contagens iguais
   * antes e depois do ROLLBACK): o maior ID das tabelas grandes do legado e a contagem das SGH_ (só números).
   */
  const marcaDoc = () =>
    a.nucleo.lerSomente(ctx(a), (l) =>
      contar(l, 'SELECT GEN_ID(GEN_PRASSINATURA_DOC_ID, 0) N FROM RDB$DATABASE'),
    );
  // PRASSINATURA_DOC (documentos em BLOB) não tem índice descendente: o MAX(ID) varre a tabela e passa do tempo; conta
  // pelo índice da chave as linhas acima da marca do gerador lida antes (0 antes e 0 depois do ROLLBACK).
  const retrato = (marca: number) =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      prpresc: await contar(l, 'SELECT MAX(ID) N FROM PRPRESC'),
      prlangeral: await contar(l, 'SELECT MAX(ID) N FROM PRLANGERAL'),
      prprescdieta: await contar(l, 'SELECT MAX(ID) N FROM PRPRESCDIETA'),
      prchkgeral: await contar(l, 'SELECT MAX(ID) N FROM PRCHKGERAL'),
      assinaturaCab: await contar(l, 'SELECT MAX(ID) N FROM PRASSINATURA_CAB'),
      assinaturaDoc: await contar(l, 'SELECT COUNT(*) N FROM PRASSINATURA_DOC WHERE ID > ?', [marca]),
      terapia: await contar(l, 'SELECT COUNT(*) N FROM SGH_PEP_NUTRI_TERAPIA'),
      social: await contar(l, 'SELECT COUNT(*) N FROM SGH_PEP_SOCIAL'),
      barreiras: await contar(l, 'SELECT COUNT(*) N FROM SGH_INT_BARREIRA_ALTA'),
      trilha: await contar(l, 'SELECT MAX(ID) N FROM SGH_TRILHA'),
    }));

  it('as leituras da fila, da terapia e do mapa no tempo-alvo, com o mapa montado pelo domínio (só contagens)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [{ HOJE: hoje, AGORA: agora }] = (await l.consultar(
        'SELECT CAST(CURRENT_DATE AS VARCHAR(10)) HOJE, CURRENT_TIMESTAMP AGORA FROM RDB$DATABASE',
        [],
        { teto: 1 },
      )) as [{ HOJE: string; AGORA: Date }];
      const agoraTxt = local(agora);
      const fila = await cronometrar(async () => {
        const i = await internadosParaNutricao(l, null);
        const regs = i.itens.map((x) => x.reg);
        await triagensDasInternacoes(l, a.cod, regs);
        await internacoesComMeta(l, a.cod, regs);
        return i;
      });
      const situacoes = fila.r.itens.map((i) =>
        situacaoTriagem({
          admissao: i.admissao,
          agora: agoraTxt,
          ultima: null,
          prazos: PRAZOS_TRIAGEM_PADRAO,
        }),
      );
      const refeicoes = refeicoesComCorte(await refeicoesDoCadastro(l), 120, new Map());
      const almoco = refeicoes.find((x) => x.codigo === 2) ?? refeicoes[0]!;
      // O dia de referência: o da prescrição mais recente dos internados (a cópia é um retrato; a prescrição de hoje
      // pode não existir), para o mapa sair da prescrição real.
      const atendimentos = fila.r.itens.map((i) => i.atendimento).filter((x): x is number => x !== null);
      const [mx] = atendimentos.length
        ? await l.consultar(
            `SELECT MAX(p.DATA_HORA_INICIAL_VIGENCIA) M FROM PRPRESC p WHERE p.ID_ATCABECATEND_INTEGRACAO IN (${atendimentos.map(() => '?').join(', ')})`,
            atendimentos,
            { teto: 1 },
          )
        : [];
      const ultima = mx?.['M'] instanceof Date ? local(mx['M'] as Date) : null;
      const diaRef =
        ultima === null
          ? hoje
          : ultima.slice(11, 16) <= almoco.horario
            ? ultima.slice(0, 10)
            : new Date(Date.parse(`${ultima.slice(0, 10)}T12:00:00Z`) + 86_400_000)
                .toISOString()
                .slice(0, 10);
      const { servirEm, corteEm } = instantesDaRefeicao(diaRef, almoco);
      const blocos = [...new Set(fila.r.itens.map((i) => i.bloco))];
      let maxMapa = 0;
      const contagens: Record<string, number> = {};
      for (const bloco of blocos) {
        const m = await cronometrar(async () => {
          const internados = (await internadosParaNutricao(l, bloco)).itens.filter(
            (x) => x.atendimento !== null,
          );
          const [itens, alergias, cirurgias, exames, acomp, retrato] = await Promise.all([
            itensDietaDosAtendimentos(
              l,
              internados.map((x) => x.atendimento as number),
              servirEm,
            ),
            alergiasAlimentaresDosPacientes(
              l,
              internados.map((x) => x.paciente),
            ),
            cirurgiasNaJanela(l, `${diaRef}T00:00`, `${diaRef}T23:59`),
            examesNaJanela(
              l,
              internados.map((x) => x.pront),
              diaRef,
              diaRef,
            ),
            acompanhantesVigentes(
              l,
              a.cod,
              internados.map((x) => x.reg),
            ),
            retratoDoMapa(l, a.cod, bloco, almoco.codigo, diaRef),
          ]);
          void retrato;
          return internados.map((i) =>
            linhaDoMapa(
              {
                ...i,
                internacao: i.reg,
                prontuario: i.pront,
                leito: { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito },
              },
              itens.filter((x) => x.atendimento === i.atendimento),
              {
                cirurgias: cirurgias
                  .filter((x) => x.reg === i.reg || x.pront === i.pront)
                  .map((x) => ({ inicio: x.inicio, duracaoMin: x.duracaoMin, descricao: 'cirurgia' })),
                exames: exames
                  .filter((x) => x.pront === i.pront)
                  .map((x) => ({ inicio: x.inicio, exame: x.exame, descricao: 'exame' })),
              },
              alergias.get(i.paciente) ?? [],
              acomp.get(i.reg) ?? null,
              {
                servirEm,
                corteEm,
                agora: agoraTxt,
                regraJejum: { horasCirurgia: 8, horasExame: 8, examesComJejum: new Set() },
                refeicao: almoco.codigo,
                data: diaRef,
              },
            ),
          );
        });
        maxMapa = Math.max(maxMapa, m.maxMs);
        for (const [k, v] of Object.entries(contagensDoMapa(m.r))) contagens[k] = (contagens[k] ?? 0) + v;
      }
      // A terapia (a dieta enteral, as checagens e as fichas) do primeiro internado com atendimento.
      const um = fila.r.itens.find((i) => i.atendimento !== null);
      const terapia = um
        ? await cronometrar(async () => {
            const d = await dietasEnteraisDoAtendimento(
              l,
              um.atendimento as number,
              instanteCivil(`${hoje}T00:00`),
            );
            if (d.length)
              await checagensDasDietas(
                l,
                d.map((x) => x.item),
                instanteCivil(`${hoje}T00:00`),
              );
            await terapiaDaInternacao(l, a.cod, um.reg);
            return fichasNutricionais(l, um.paciente);
          })
        : { r: { quantidade: 0, ultima: null }, maxMs: 0 };
      return {
        internados: fila.r.itens.length,
        blocos: blocos.length,
        refeicoes: refeicoes.length,
        situacoes: situacoes.length,
        filaMs: fila.maxMs,
        mapaMs: maxMapa,
        terapiaMs: terapia.maxMs,
        diaRefIgualHoje: diaRef === hoje,
        contagens,
      };
    });
    console.log(`[m45-e5] leituras: ${JSON.stringify(r)}`);
    expect(r.refeicoes).toBeGreaterThan(0);
    expect(r.situacoes).toBe(r.internados);
    expect(r.filaMs).toBeLessThan(500);
    expect(r.mapaMs).toBeLessThan(1_000);
    expect(r.terapiaMs).toBeLessThan(1_000);
    // Com a prescrição real do dia de referência, o mapa tem alguma linha com dieta.
    expect(Object.entries(r.contagens).some(([k, v]) => k !== 'sem-prescricao' && v > 0)).toBe(true);
  });

  it('jejum da agenda: a cirurgia agendada de uma internação põe em jejum a refeição das horas antes', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar(
        'SELECT FIRST 1 DATA_HORA FROM CCAGENDA WHERE REG > 0 AND DATA_HORA > CAST(? AS TIMESTAMP) ORDER BY DATA_HORA DESC',
        [instanteCivil('2020-01-01T00:00')],
        { teto: 1 },
      );
      if (!x) return null;
      const inicio = local(x['DATA_HORA'] as Date);
      const servir = new Date(Date.parse(`${inicio}:00Z`) - 3 * 3_600_000).toISOString().slice(0, 16);
      const t0 = performance.now();
      const cirurgias = await cirurgiasNaJanela(
        l,
        servir,
        new Date(Date.parse(`${servir}:00Z`) + 8 * 3_600_000).toISOString().slice(0, 16),
      );
      const ms = Math.round(performance.now() - t0);
      const alvo = cirurgias.find((c) => c.inicio === inicio && c.reg !== null);
      const jejum = alvo
        ? jejumAgendado(
            servir,
            {
              cirurgias: [{ inicio: alvo.inicio, duracaoMin: alvo.duracaoMin, descricao: 'cirurgia' }],
              exames: [],
            },
            { horasCirurgia: 8, horasExame: 8, examesComJejum: new Set() },
          )
        : null;
      const depois = alvo
        ? jejumAgendado(
            new Date(Date.parse(`${inicio}:00Z`) + (alvo.duracaoMin + 60) * 60_000)
              .toISOString()
              .slice(0, 16),
            {
              cirurgias: [{ inicio: alvo.inicio, duracaoMin: alvo.duracaoMin, descricao: 'cirurgia' }],
              exames: [],
            },
            { horasCirurgia: 8, horasExame: 8, examesComJejum: new Set() },
          )
        : null;
      return { naJanela: cirurgias.length, achou: !!alvo, origem: jejum?.origem ?? null, depois, ms };
    });
    console.log(`[m45-e5] jejum-agenda: ${JSON.stringify(r)}`);
    expect(r).not.toBeNull();
    expect(r!.achou).toBe(true);
    expect(r!.origem).toBe('cirurgia');
    expect(r!.depois).toBeNull();
    expect(r!.ms).toBeLessThan(1_000);
  });

  it('dieta prescrita sobre a de outro profissional: a enteral da nutricionista pela receita, a terapia e a meta', async () => {
    const marca = await marcaDoc();
    const antes = await retrato(marca);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const nutri = await prescritorDaCopia(e, '2237');
      const medico = await prescritorDaCopia(e, '2251');
      const at = await atendimentoAberto(e);
      const c = await cadastrosDoCenario(e);
      const item = await itemDaForma(e, { tipo: 'dieta-enteral', frequencia: 11, horarios: 4 }, 0, c, []);
      const g = await gravacaoDe(e, at, nutri, [item], c);
      const s = await a.executor.executar(operacao('pep.prescrever'), a.cod, g, ctxOperacao(a, nutri.login), {
        escritor: e,
      });
      const prescricao = num(s.resultado['prescricao']);
      const desde = instanteCivil('2000-01-01T00:00');
      const dietas = await dietasEnteraisDoAtendimento(e, at.id, desde);
      const minha = dietas.find((d) => d.prescricao === prescricao);
      // O médico vê a dieta ativa de outro profissional (a da nutricionista) no período.
      const [cab] = await e.consultar(
        'SELECT DATA_HORA_INICIAL_VIGENCIA I, DATA_HORA_FINAL_VIGENCIA F FROM PRPRESC WHERE ID = ?',
        [prescricao],
        { teto: 1 },
      );
      const deOutro = await dietaAtivaDeOutro(e, at.id, cab!['I'] as Date, cab!['F'] as Date, medico.cbo);
      // A meta da EMTN (SGH_) ligada ao detalhe da dieta, na mesma transação.
      const m = calcularMeta({
        pesoKg: 70,
        kcalPorKg: 25,
        proteinaGPorKg: 1.5,
        densidadeKcalMl: 1.5,
        proteinaGL: 60,
      });
      const meta = minha
        ? await registrarMetaTerapiaSgh(somenteSgh(e), {
            hospital: a.cod,
            reg: 2_000_000_455,
            pront: 2_000_000_455,
            paciente: at.paciente,
            via: 'enteral',
            itemDieta: minha.itemDieta,
            dieta: minha.dieta,
            pesoKg: 70,
            kcalPorKg: 25,
            proteinaGPorKg: 1.5,
            densidadeKcalMl: 1.5,
            proteinaGL: 60,
            ...m,
            observacao: null,
            vinculo: nutri.cbo,
            usuario: nutri.login,
          })
        : 0;
      const terapia = await terapiaDaInternacao(e, a.cod, 2_000_000_455);
      return {
        enteral: !!minha,
        cbo: (minha?.cboLancamento ?? '').slice(0, 4),
        plano: minha?.plano ?? null,
        deOutro: deOutro?.prescricao === prescricao,
        meta: meta > 0,
        metaLigada: terapia.metas[0]?.itemDieta === minha?.itemDieta,
      };
    });
    console.log(`[m45-e5] dieta-de-outro: ${JSON.stringify(r)}`);
    expect(r).toEqual({ enteral: true, cbo: '2237', plano: 4, deOutro: true, meta: true, metaLigada: true });
    // Nada ficou na cópia: as contagens iguais antes e depois do ROLLBACK.
    const depois = await retrato(marca);
    console.log(
      `[m45-e5] dieta-de-outro: retrato igual depois do ROLLBACK = ${JSON.stringify(depois) === JSON.stringify(antes)}`,
    );
    expect(depois).toEqual(antes);
  });

  it('serviço social: o corpus CP1252 no parecer, a barreira social do NIR na mesma transação e o sigilo; só SGH_', async () => {
    const parecer = `Parecer SINTETICO ${CORPUS.join(' ')}`.slice(0, 3_900);
    const marca = await marcaDoc();
    const antes = await retrato(marca);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e = somenteSgh(e0);
      const reg = 2_000_000_455;
      const s = await registrarAvaliacaoSocialSgh(e, {
        hospital: a.cod,
        reg,
        pront: reg,
        paciente: reg,
        tipo: 'avaliacao',
        redeApoio: 'fragil',
        vulnerabilidades: ['sem-cuidador', 'transporte'],
        risco: 'medio',
        encaminhamentos: ['familia'],
        parecer,
        orientacoes: 'Orientação à equipe — sintética',
        barreira: {
          descricao: 'Sem cuidador — sintético',
          responsavel: 'Serviço social',
          prazo: '2026-11-01',
        },
        vinculo: 1,
        usuario: 'SGH.TESTE.M45',
      });
      const trilha = await gravarTrilha(e, {
        rede: a.nucleo.rede,
        hospital: a.cod,
        usuario: 'SGH.TESTE.M45',
        evento: 'pep.avaliacaoSocial.registrada',
        recurso: 'pep.social',
        operacao: 'pep.registrarAvaliacaoSocial',
        tabelaAlvo: 'SGH_PEP_SOCIAL',
        idAlvo: String(s.id),
        chaveNaturalAlvo: `${reg}:avaliacao:medio`,
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:m45',
        correlacao: 'teste-m45-e5-social',
        origem: 'SGH-TESTE:m45',
      });
      const lidos = await registrosSociaisDaInternacao(e, a.cod, reg);
      const lido = lidos[0]!;
      const [linhaTrilha] = await e.consultar(
        'SELECT * FROM SGH_TRILHA WHERE ID = CAST(? AS BIGINT)',
        [trilha.id],
        {
          teto: 1,
        },
      );
      // W0-05: o registro lido ganhou a situação e a correção (ativo e sem correção aqui).
      const comoLido = { ...lido, sigilo: false, situacao: 'ativo' as const, correcao: null };
      const equipe = comSigiloSocial(comoLido, 'enfermagem');
      const categoria = comSigiloSocial(comoLido, 'servico-social');
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      const classes = await classesDaLinhaSgh(e, 'SGH_PEP_SOCIAL', String(s.id));
      return {
        igual: lido.parecer === parecer,
        barreira: lido.barreira === s.barreira && s.barreira !== null,
        naTrilha: JSON.stringify(linhaTrilha ?? {}).includes('Parecer SINTETICO'),
        equipe: { parecer: equipe.parecer, sigilo: equipe.sigilo, orientacoes: equipe.orientacoes !== null },
        categoria: categoria.parecer === parecer,
        tabelas,
        risco: classes['RISCO']?.classe,
      };
    });
    console.log(`[m45-e5] social: ${JSON.stringify({ ...r, tabelas: r.tabelas })}`);
    expect(r.igual).toBe(true);
    expect(r.barreira).toBe(true);
    expect(r.naTrilha).toBe(false);
    expect(r.equipe).toEqual({ parecer: null, sigilo: true, orientacoes: true });
    expect(r.categoria).toBe(true);
    expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(r.tabelas).toEqual(
      expect.arrayContaining(['SGH_INT_BARREIRA_ALTA', 'SGH_PEP_SOCIAL', 'SGH_TRILHA']),
    );
    expect(r.risco).toBe('constante:medio');
    const depois = await retrato(marca);
    console.log(
      `[m45-e5] social: retrato igual depois do ROLLBACK = ${JSON.stringify(depois) === JSON.stringify(antes)}`,
    );
    expect(depois).toEqual(antes);
  });

  it('os vínculos dos logins de nutricionista na cópia: a categoria pelo CBO (só a contagem)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const logins = await l.consultar(
        `SELECT FIRST 5 u.NOME L FROM TBCBOPRO c JOIN TBPROFIS p ON p.ID = c.ID_TBPROFIS JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')}
           JOIN TBCBOSUS s ON s.ID = c.ID_TBCBOSUS WHERE s.COD STARTING WITH '2237' AND c.COD > 0 AND COALESCE(c.ATIVO, 'T') <> 'F'`,
        [],
        { teto: 5 },
      );
      let comCategoria = 0;
      let pessoais = 0;
      for (const x of logins) {
        const login = String(x['L'] ?? '').trim();
        const v = await vinculosCategoriaDoLogin(l, login);
        if (v.some((y) => y.cbo.startsWith('2237'))) comCategoria += 1;
        // Conta compartilhada (D-VINCULO-455): o limite padrão é 3 cadastros de profissional por login.
        if ((await cadastrosProfissionaisDoLogin(l, login)) <= 3) pessoais += 1;
      }
      // A distribuição dos cadastros por login entre os logins com CBO de nutricionista ou assistente social (agregada).
      const faixas = await l.consultar(
        `SELECT CASE WHEN n = 1 THEN '1' WHEN n <= 3 THEN '2-3' WHEN n <= 20 THEN '4-20' ELSE '21+' END F, COUNT(*) Q
           FROM (SELECT p.ID_TBUSERS U, COUNT(*) n FROM TBPROFIS p WHERE p.ID_TBUSERS IN (
                   SELECT p2.ID_TBUSERS FROM TBCBOPRO c JOIN TBPROFIS p2 ON p2.ID = c.ID_TBPROFIS
                     JOIN TBCBOSUS s ON s.ID = c.ID_TBCBOSUS
                    WHERE (s.COD STARTING WITH '2237' OR s.COD STARTING WITH '2516') AND c.COD > 0)
                 GROUP BY p.ID_TBUSERS) GROUP BY 1`,
        [],
        { teto: 10 },
      );
      const distribuicao = Object.fromEntries(
        faixas.map((f) => [String(f['F']).trim(), Number(f['Q']) < 5 ? '<5' : Number(f['Q'])]),
      );
      return { logins: logins.length, comCategoria, pessoais, distribuicao };
    });
    console.log(
      `[m45-e5] vinculos: ${JSON.stringify({ logins: r.logins < 5 ? '<5' : r.logins, comCategoria: r.comCategoria < 5 ? '<5' : r.comCategoria, pessoais: r.pessoais < 5 ? '<5' : r.pessoais, distribuicao: r.distribuicao })}`,
    );
    expect(r.comCategoria).toBe(r.logins);
  });
});
