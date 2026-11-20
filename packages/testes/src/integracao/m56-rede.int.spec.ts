// Etapa 4 do M56 (fatia F3, rede credenciada da operadora própria) sobre a cópia, sempre em transação desfeita e sob a
// trava (ficha, seções 4 a 6 e 11):
//   - os 10 domínios da rede lidos do banco do estabelecimento batem com os códigos que as regras do novo usam
//     (vocabulário de @sgh/contratos), e os convênios do hospital estão lá para ligar a operadora;
//   - o ciclo credenciar (pessoa jurídica, pessoa física e o próprio hospital) → alterar (com e sem campo do RPS) →
//     descredenciar com o substituto relido com trava → reincluir, cada passo com o movimento do RPS na MESMA transação;
//   - a saída agendada (data efetiva no futuro): segue credenciado na lista e nas contagens até a data, não se altera e não
//     serve de substituto; a saída com a data de hoje vale na hora;
//   - as recusas do banco: documento repetido e o mesmo hospital da Rede duas vezes (chaves únicas; várias linhas sem
//     estabelecimento convivem), a versão vista, o contrato com o fim antes do início (CHECK);
//   - o escopo: o prestador de outro estabelecimento da operadora não aparece na lista deste;
//   - a SGH_TRILHA na mesma transação (contada antes e depois do ROLLBACK) e o monitoramento da transação só com tabelas SGH_ (seção 5: nenhuma escrita em
//     tabela legada);
//   - a primeira página da lista dentro do tempo-alvo.
// Documentos SINTÉTICOS (dígitos calculados); saída só com contagens, códigos e tempos.
import {
  CLASSIFICACOES_REDE,
  CONTRATACOES_PRESTADOR,
  DISPONIBILIDADES_SERVICO,
  FORMAS_REAJUSTE,
  ISENCOES_ONUS,
  MODELOS_REMUNERACAO,
  MOVIMENTOS_REDE,
  REGIMES_ATENDIMENTO_OPERADORA,
  TIPOS_PRESTADOR_REDE,
} from '@sgh/contratos';
import {
  alterarPrestadorSgh,
  type CamposPrestadorSgh,
  credenciarPrestadorSgh,
  descredenciarPrestadorSgh,
  dominiosDaRede,
  ErroOperacao,
  escritasDaTransacao,
  gravarTrilha,
  listarConvenios,
  movimentosRps,
  prestadoresDaRede,
  prestadorPorId,
  reincluirPrestadorSgh,
  somenteSgh,
  totaisDaRede,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const USUARIO = 'SGH.TESTE.M56';
const CORRELACAO = 'integracao-m56-rede';
const TRILHA_DO_TESTE = 'SELECT COUNT(*) N FROM SGH_TRILHA WHERE CORRELACAO = ? AND OPERACAO = ?';
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function cnpj(base12: string): string {
  const dv = (b: string) => {
    let s = 0;
    let p = 2;
    for (let i = b.length - 1; i >= 0; i--) {
      s += (b.charCodeAt(i) - 48) * p;
      p = p === 9 ? 2 : p + 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const a = base12 + String(dv(base12));
  return a + String(dv(a));
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `banco: ${(e as Error).message}`;
  }
}

const CAMPOS: CamposPrestadorSgh = {
  nome: 'Laboratório SINTÉTICO M56 da integração',
  nomeFantasia: null,
  cnes: '9056001',
  uf: 'SC',
  municipioIbge: 4205407,
  tipo: 4,
  natureza: 1,
  classificacao: 3,
  contratacao: 1,
  operadoraIntermediaria: null,
  disponibilidade: 1,
  isencaoOnus: 1,
  urgencia: false,
  regime: 1,
  remuneracao: 1,
  contrato: { numero: 'SINT-M56-1', inicio: '2026-11-01', fim: null, formaReajuste: 1, mesReajuste: 11 },
  ehOHospital: false,
  estabelecimento: null,
  convenio: null,
};

describe.skipIf(!PODE_ESCREVER)('M56 etapa 4 (rede credenciada) na cópia (transação desfeita)', () => {
  let a: Ambiente;

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      prestadores: await contar(l, 'SELECT COUNT(*) N FROM SGH_OPE_PRESTADOR'),
      movimentos: await contar(l, 'SELECT COUNT(*) N FROM SGH_OPE_PRESTADOR_MOV'),
      // A trilha da gravação também é desfeita (gravada fora da transação, o ROLLBACK não a levaria).
      trilhas: await contar(l, TRILHA_DO_TESTE, [CORRELACAO, 'operadora.credenciarPrestador']),
    }));

  it('os domínios da rede lidos do banco batem com os códigos das regras; os convênios do hospital existem', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => ({
      d: await dominiosDaRede(l),
      convenios: (await listarConvenios(l)).length,
    }));
    const codigos = (o: object) => Object.keys(o).map(Number);
    expect(r.d.tipo.map((x) => x.codigo)).toEqual(codigos(TIPOS_PRESTADOR_REDE));
    expect(r.d.classificacao.map((x) => x.codigo)).toEqual(codigos(CLASSIFICACOES_REDE));
    expect(r.d.contratacao.map((x) => x.codigo)).toEqual(codigos(CONTRATACOES_PRESTADOR));
    expect(r.d.disponibilidade.map((x) => x.codigo)).toEqual(codigos(DISPONIBILIDADES_SERVICO));
    expect(r.d.isencaoOnus.map((x) => x.codigo)).toEqual(codigos(ISENCOES_ONUS));
    expect(r.d.regime.map((x) => x.codigo)).toEqual(codigos(REGIMES_ATENDIMENTO_OPERADORA));
    expect(r.d.remuneracao.map((x) => x.codigo)).toEqual(codigos(MODELOS_REMUNERACAO));
    expect(r.d.formaReajuste.map((x) => x.codigo)).toEqual(codigos(FORMAS_REAJUSTE));
    expect(r.d.movimento.map((x) => x.codigo)).toEqual(codigos(MOVIMENTOS_REDE));
    expect(r.d.natureza.length).toBeGreaterThan(0);
    expect(r.convenios).toBeGreaterThan(0);
    console.log(
      `[int-m56-4] ${a.cod}: domínios ${Object.entries(r.d)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(' ')}; convênios ${r.convenios}`,
    );
  });

  it('credenciar → alterar → descredenciar → reincluir, as recusas do banco e o escopo; só tabelas SGH_', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const s = somenteSgh(e);
      const h = a.cod;
      const lab = await credenciarPrestadorSgh(s, {
        ...CAMPOS,
        hospital: h,
        pessoa: 'J',
        documento: cnpj('905600010001'),
        usuario: USUARIO,
      });
      // A trilha da gravação na mesma transação (como a porta da API faz).
      await gravarTrilha(s, {
        rede: a.nucleo.rede,
        hospital: h,
        usuario: USUARIO,
        evento: 'operadora.prestador.credenciado',
        recurso: 'operadora.prestador',
        operacao: 'operadora.credenciarPrestador',
        tabelaAlvo: 'SGH_OPE_PRESTADOR',
        idAlvo: String(lab.id),
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'SGH-INTEGRACAO:m56',
        correlacao: CORRELACAO,
        origem: 'SGH-INTEGRACAO:m56',
      });
      const trilhasNaTransacao = await contar(e, TRILHA_DO_TESTE, [
        CORRELACAO,
        'operadora.credenciarPrestador',
      ]);
      const pf = await credenciarPrestadorSgh(s, {
        ...CAMPOS,
        nome: 'Consultório SINTÉTICO M56',
        cnes: null,
        tipo: 1,
        hospital: h,
        pessoa: 'F',
        documento: '52998224725',
        usuario: USUARIO,
      });
      const hosp = await credenciarPrestadorSgh(s, {
        ...CAMPOS,
        nome: 'Hospital da Rede SINTÉTICO M56',
        cnes: '9056002',
        tipo: 3,
        classificacao: 1,
        ehOHospital: true,
        estabelecimento: h,
        hospital: h,
        pessoa: 'J',
        documento: cnpj('905600020001'),
        usuario: USUARIO,
      });
      const subst = await credenciarPrestadorSgh(s, {
        ...CAMPOS,
        nome: 'Hospital substituto SINTÉTICO M56',
        cnes: '9056003',
        tipo: 3,
        classificacao: 1,
        hospital: h,
        pessoa: 'J',
        documento: cnpj('905600030001'),
        usuario: USUARIO,
      });
      // Outro estabelecimento da operadora (escopo): não aparece na lista deste.
      await credenciarPrestadorSgh(s, {
        ...CAMPOS,
        nome: 'Laboratório SINTÉTICO M56 de outro estabelecimento',
        hospital: 'zzm56',
        pessoa: 'J',
        documento: cnpj('905600040001'),
        usuario: USUARIO,
      });
      // As recusas do banco (cada uma desfaz só o próprio comando).
      const repetido = await codigo(
        credenciarPrestadorSgh(s, {
          ...CAMPOS,
          hospital: h,
          pessoa: 'J',
          documento: cnpj('905600010001'),
          usuario: USUARIO,
        }),
      );
      const outroHospital = await codigo(
        credenciarPrestadorSgh(s, {
          ...CAMPOS,
          ehOHospital: true,
          estabelecimento: h,
          hospital: h,
          pessoa: 'J',
          documento: cnpj('905600050001'),
          usuario: USUARIO,
        }),
      );
      const fimAntes = await codigo(
        credenciarPrestadorSgh(s, {
          ...CAMPOS,
          contrato: { ...CAMPOS.contrato, fim: '2026-10-01' },
          hospital: h,
          pessoa: 'J',
          documento: cnpj('905600060001'),
          usuario: USUARIO,
        }),
      );
      // Alterar: o regime não vai ao RPS; o CNES vai; a versão velha é recusada.
      const a1 = await alterarPrestadorSgh(s, {
        ...CAMPOS,
        regime: 2,
        hospital: h,
        id: lab.id,
        versao: 1,
        camposRps: [],
        usuario: USUARIO,
      });
      const a2 = await alterarPrestadorSgh(s, {
        ...CAMPOS,
        regime: 2,
        cnes: '9056009',
        hospital: h,
        id: lab.id,
        versao: 2,
        camposRps: ['cnes'],
        usuario: USUARIO,
      });
      const velha = await codigo(
        alterarPrestadorSgh(s, {
          ...CAMPOS,
          hospital: h,
          id: lab.id,
          versao: 1,
          camposRps: [],
          usuario: USUARIO,
        }),
      );
      // Descredenciar o hospital da Rede com o substituto (relido com trava): a saída fica agendada para a data
      // efetiva (no futuro, relógio do banco); até lá ele segue credenciado. Depois, reincluir (cancela a saída).
      const [relogio] = await e.consultar(
        `SELECT CAST(CURRENT_DATE AS VARCHAR(10)) HOJE FROM RDB$DATABASE`,
        [],
        {
          teto: 1,
        },
      );
      const hoje = String(relogio?.['HOJE']);
      const saida = somaDias(hoje, 60);
      const desc = await descredenciarPrestadorSgh(s, {
        hospital: h,
        id: hosp.id,
        versao: 1,
        motivo: 'Encerramento SINTÉTICO do contrato (integração M56)',
        efetivoEm: saida,
        avisoBeneficiariosEm: hoje,
        substituto: subst.id,
        autorizacaoAns: null,
        usuario: USUARIO,
      });
      const outraVez = await codigo(
        descredenciarPrestadorSgh(s, {
          hospital: h,
          id: hosp.id,
          versao: desc.versao,
          motivo: 'Segunda vez SINTÉTICA',
          efetivoEm: saida,
          avisoBeneficiariosEm: hoje,
          substituto: null,
          autorizacaoAns: null,
          usuario: USUARIO,
        }),
      );
      const lido = await prestadorPorId(e, h, hosp.id);
      const credenciadosAgendado = (
        await prestadoresDaRede(e, h, { busca: 'SINTÉTICO M56', situacao: 'credenciado' })
      ).itens.map((p) => p.id);
      const descredenciadosAgendado = (
        await prestadoresDaRede(e, h, { busca: 'SINTÉTICO M56', situacao: 'descredenciado' })
      ).itens.map((p) => p.id);
      const totaisAgendado = await totaisDaRede(e, h);
      // Com a saída agendada: não se altera (a exclusão já está no RPS) e não serve de substituto.
      const alterarAgendado = await codigo(
        alterarPrestadorSgh(s, {
          ...CAMPOS,
          hospital: h,
          id: hosp.id,
          versao: desc.versao,
          camposRps: [],
          usuario: USUARIO,
        }),
      );
      const substitutoAgendado = await codigo(
        descredenciarPrestadorSgh(s, {
          hospital: h,
          id: lab.id,
          versao: a2.versao,
          motivo: 'Substituto com a saída agendada (SINTÉTICO)',
          efetivoEm: saida,
          avisoBeneficiariosEm: hoje,
          substituto: hosp.id,
          autorizacaoAns: null,
          usuario: USUARIO,
        }),
      );
      // A saída com a data de hoje vale na hora: o consultório vira descredenciado (aviso dado há 30 dias).
      await descredenciarPrestadorSgh(s, {
        hospital: h,
        id: pf.id,
        versao: 1,
        motivo: 'Saída imediata SINTÉTICA',
        efetivoEm: hoje,
        avisoBeneficiariosEm: somaDias(hoje, -30),
        substituto: null,
        autorizacaoAns: null,
        usuario: USUARIO,
      });
      const pfDescredenciado = await prestadorPorId(e, h, pf.id);
      const reinc = await reincluirPrestadorSgh(s, {
        hospital: h,
        id: hosp.id,
        versao: desc.versao,
        motivo: 'Novo contrato SINTÉTICO (integração M56)',
        contrato: { ...CAMPOS.contrato, numero: 'SINT-M56-2' },
        usuario: USUARIO,
      });
      const t0 = Date.now();
      const lista = await prestadoresDaRede(e, h, { busca: 'SINTÉTICO M56' });
      const ms = Date.now() - t0;
      const pfLido = await prestadorPorId(e, h, pf.id);
      const totais = await totaisDaRede(e, h);
      const movs = await movimentosRps(e, h, { prestador: hosp.id });
      const pendentes = await movimentosRps(e, h, { situacao: 'pendente' });
      const escritas = await escritasDaTransacao(e);
      return {
        trilhasNaTransacao,
        saida,
        credenciadosAgendado,
        descredenciadosAgendado,
        totaisAgendado,
        alterarAgendado,
        substitutoAgendado,
        pfDescredenciado,
        hospId: hosp.id,
        pfId: pf.id,
        repetido,
        outroHospital,
        fimAntes,
        a1,
        a2,
        velha,
        desc,
        outraVez,
        lido,
        reinc,
        lista,
        ms,
        pfLido,
        totais,
        movs,
        pendentes: pendentes.itens.length,
        escritas,
      };
    });
    expect(r.repetido).toBe('documento-ja-credenciado');
    expect(r.outroHospital).toBe('hospital-ja-na-rede');
    expect(r.fimAntes).toMatch(/SGH_CK_OPE_PREST_CONTRATO/);
    expect(r.a1.movimento).toBeNull();
    expect(r.a2.movimento).not.toBeNull();
    expect(r.velha).toBe('prestador-desatualizado');
    expect(r.outraVez).toBe('prestador-desatualizado');
    expect(r.trilhasNaTransacao).toBe(1);
    // A saída agendada: segue credenciado (lista e contagens) até a data, com a data da saída.
    expect(r.lido).toMatchObject({ situacao: 'credenciado', saidaEm: r.saida, situacaoEm: r.saida });
    expect(r.credenciadosAgendado).toContain(r.hospId);
    expect(r.descredenciadosAgendado).not.toContain(r.hospId);
    expect(r.totaisAgendado.saidasAgendadas).toBeGreaterThanOrEqual(1);
    expect(r.alterarAgendado).toBe('prestador-desatualizado');
    expect(r.substitutoAgendado).toBe('substituto-descredenciado');
    expect(r.pfDescredenciado).toMatchObject({ situacao: 'descredenciado', saidaEm: null });
    expect(r.reinc.versao).toBe(3);
    // Escopo: os 4 deste estabelecimento, nunca o do outro; a ordem pelo nome de busca.
    expect(r.lista.itens).toHaveLength(4);
    expect(r.lista.itens.every((p) => !p.nome.includes('outro estabelecimento'))).toBe(true);
    expect(r.ms).toBeLessThan(300);
    expect(r.pfLido).toMatchObject({ pessoa: 'F', documento: '52998224725', cnes: null });
    expect(r.totais.credenciados).toBeGreaterThanOrEqual(3);
    expect(r.totais.descredenciados).toBeGreaterThanOrEqual(1);
    expect(r.movs.itens.map((m) => m.movimento)).toEqual([4, 3, 1]);
    expect(r.pendentes).toBeGreaterThanOrEqual(8);
    // Seção 5: só tabelas SGH_ na transação.
    expect(r.escritas.map((x) => x.tabela).sort()).toEqual([
      'SGH_OPE_PRESTADOR',
      'SGH_OPE_PRESTADOR_MOV',
      'SGH_TRILHA',
    ]);
    const depois = await retrato();
    expect(depois).toEqual(antes);
    console.log(
      `[int-m56-4] ${a.cod}: ciclo credenciar/alterar/descredenciar/reincluir com o RPS na mesma transação (${r.movs.itens.length} movimentos do hospital), recusas ${[r.repetido, r.outroHospital, r.velha].join(', ')} e o CHECK do contrato; lista em ${r.ms} ms; escritas só em ${r.escritas.map((x) => x.tabela).join(', ')}; ROLLBACK igual (${antes.prestadores} prestadores, ${antes.movimentos} movimentos, ${antes.trilhas} trilhas do teste)`,
    );
  });
});
