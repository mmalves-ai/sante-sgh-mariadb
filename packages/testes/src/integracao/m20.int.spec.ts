// Atendimento externo sobre a cópia (ficha do M20, seção 10), sempre em transação desfeita e sob a trava da cópia:
//   - a ficha aberta pelo executor e o escritor do outro sistema alterando o mesmo atendimento depois da leitura da
//     tela: a alteração do segurado é recusada pelo carimbo (aviso de colisão), e com o carimbo relido grava;
//   - a exceção de gatilho do banco (a chave natural do leito que não muda) chega em português, com o código;
//   - o banco externo do cadastro de bancos neutralizado na cópia (nenhuma conexão sai) e a fila HL7 de admissão
//     (OUT_ADT_A04) recebendo exatamente o que o gatilho grava quando a ficha nasce do outro sistema (a mesma regra:
//     integração do estabelecimento, da unidade e do convênio);
//   - a conta nascida no gatilho para a ficha do novo (aberta, com o item do procedimento), a mesma da assinatura;
//   - o paciente não identificado: o cadastro temporário pelo `cadastro.cadastrarPaciente`, a marca no novo e o
//     encerramento da marca na identificação;
//   - correções da revisão: o desfecho no PA tira o paciente do leito na mesma transação e não grava autor no desfecho
//     administrativo; a ficha aberta de um agendamento não é excluída (a prévia recusa) e o agendamento preenche a
//     abertura; o quadro do PA marca as saídas pela outra ponta (letra L no fluxo da senha, motivo de alta).
// Massa sintética marcada; saída só com contagens e códigos (nenhum nome).
import {
  apoioAtendimento,
  atendimentoDetalhe,
  atendimentosDoDia,
  atendimentosPaAbertos,
  buscarCid,
  carregarDominiosVistos,
  dadosDoImpresso,
  filaDoLocal,
  historicoAtendimentos,
  indicadoresAtendimento,
  leitosObservacao,
  locaisDeAtendimento,
  marcacaoParaAbertura,
  previaCancelamento,
  ErroOperacao,
  alocarObservacao,
  gravarEtapaPa,
  gravarImpresso,
  identificarPaciente,
  liberarObservacao,
  marcarNaoIdentificado,
  naoIdentificados,
  operacao,
  problemaDoLegado,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  outroSistemaAlteraAFicha,
  outroSistemaTrocaOCodigoDoLeito,
} from '../massa/atendimento-outro-sistema.js';
import { apoioDaFicha } from '../massa/reproducao-atendimento.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!PODE_ESCREVER)('atendimento externo na cópia (transação desfeita)', () => {
  let a: Ambiente;
  const tiposLogradouro =
    carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
    new Set<string>();

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      recadate: await contar(l, 'SELECT MAX(REG) N FROM RECADATE'),
      fcctaext: await contar(l, 'SELECT MAX(ID) N FROM FCCTAEXT'),
      outA04: await contar(l, 'SELECT COUNT(*) N FROM OUT_ADT_A04'),
      ext: await contar(l, 'SELECT COUNT(*) N FROM SGH_ATD_EXT'),
      naoIdentificado: await contar(l, 'SELECT COUNT(*) N FROM SGH_ATD_NAO_IDENTIFICADO'),
    }));

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    return login;
  }
  async function paciente(e: Escritor, usuario: string): Promise<{ id: number; pront: number }> {
    const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro);
    const r = await a.executor.executar(
      operacao('cadastro.cadastrarPaciente'),
      a.cod,
      pacienteSintetico('com-cep', cpf, cep),
      ctxOperacao(a, usuario),
      { escritor: e },
    );
    const id = num(r.resultado['idPaciente']);
    const [p] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [id], { teto: 1 });
    return { id, pront: num(p?.['PRONT']) };
  }

  it('ficha do novo e o outro sistema alterando o mesmo atendimento: colisão pelo carimbo; conta e fila HL7 do gatilho', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const pac = await paciente(e, usuario);
      const ap = await apoioDaFicha(e, { tipoAte: 4 });
      const a04Antes = await contar(e, 'SELECT COUNT(*) N FROM OUT_ADT_A04');
      const aberta = await exec('atendimento.abrirAtendimento', {
        tipo: 'consulta',
        paciente: pac.id,
        convenio: ap.convenio,
        plano: 'PLANO SINTETICO M20',
        matricula: '900000000020',
        validadeCarteira: '2030-12-31',
        profissional: ap.profissional,
        especialidade: ap.especialidade,
        unidade: ap.unidade,
        centroCusto: ap.centroCusto,
        procedimento: ap.procedimento,
        carater: 'eletivo',
        cidPrincipal: ap.cid,
      });
      const reg = num(aberta.resultado['reg']);
      // A fila HL7 recebe o que o gatilho grava para qualquer ficha (a mesma regra do outro sistema).
      const [cfg] = await e.consultar(
        `SELECT (SELECT COUNT(*) FROM TBHOSPIT WHERE COALESCE(IDENTIFICACAO_ALERT_TOLIFE, ' ') <> ' ') H,
           (SELECT COUNT(*) FROM TBUNIDAD WHERE COD = ? AND INTEGRAR_TOLIFE = 'T') U,
           (SELECT COUNT(*) FROM TBCONVEN WHERE COD = ? AND INTEGRAR_ALERT = 'T') C FROM RDB$DATABASE`,
        [ap.unidade, ap.convenio],
        { teto: 1 },
      );
      const integra = num(cfg?.['H']) > 0 && num(cfg?.['U']) > 0 && num(cfg?.['C']) > 0;
      const a04Depois = await contar(e, 'SELECT COUNT(*) N FROM OUT_ADT_A04');
      // A conta nascida no gatilho: aberta, com o item do procedimento (a assinatura confere coluna a coluna).
      const [conta] = await e.consultar(
        `SELECT c.FECHADA F, (SELECT COUNT(*) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID AND l.PROCTO = ?) I
           FROM FCCTAEXT c WHERE c.COD = ? AND c.TIPO_CTA = 'E'`,
        [ap.procedimento, reg],
        { teto: 1 },
      );
      // A tela leu o carimbo; o outro sistema altera a mesma ficha um instante depois.
      const versao = async () => {
        const [v] = await e.consultar(
          'SELECT CAST(DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V FROM RECADATE WHERE REG = ?',
          [reg],
          { teto: 1 },
        );
        return String(v?.['V'] ?? '');
      };
      const lida = { versao: await versao() };
      await esperar(1_100);
      await outroSistemaAlteraAFicha(e, reg);
      const colisao = await codigo(
        exec('atendimento.alterarSegurado', {
          atendimento: reg,
          versao: lida.versao,
          matricula: '900000000021',
        }),
      );
      const relida = { versao: await versao() };
      const comRelida = await codigo(
        exec('atendimento.alterarSegurado', {
          atendimento: reg,
          versao: relida.versao,
          matricula: '900000000021',
        }),
      );
      const [cab] = await e.consultar(
        'SELECT a.MATRICULA M FROM RECADATE r JOIN ATCABECATEND a ON a.ID = r.ID_ATCABECATEND WHERE r.REG = ?',
        [reg],
        { teto: 1 },
      );
      return {
        a04: a04Depois - a04Antes,
        a04Esperado: integra ? 1 : 0,
        contaAberta: String(conta?.['F'] ?? '').trim(),
        itemNaConta: num(conta?.['I']) >= 1,
        carimboMudou: lida.versao !== relida.versao,
        colisao,
        comRelida,
        cabecalhoComACarteirinha: String(cab?.['M'] ?? '').trim() === '900000000021',
      };
    });
    expect(r).toEqual({
      a04: r.a04Esperado,
      a04Esperado: r.a04Esperado,
      contaAberta: 'N',
      itemNaConta: true,
      carimboMudou: true,
      colisao: 'conflito-versao',
      comRelida: 'gravou',
      cabecalhoComACarteirinha: true,
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] colisão e conta: ${JSON.stringify(r)}`);
  });

  it('leituras das telas no último dia de movimento da cópia (READ ONLY, só contagens)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [u] = await l.consultar(
        "SELECT CAST(MAX(DT_ATE) AS VARCHAR(10)) D FROM RECADATE WHERE LAB = 'N'",
        [],
        {
          teto: 1,
        },
      );
      const dia = String(u?.['D'] ?? '');
      const t0 = Date.now();
      const doDia = await atendimentosDoDia(l, a.cod, { data: dia, requisicoes: true });
      const msDia = Date.now() - t0;
      const primeiro = doDia.itens.find((x) => !x.requisicao);
      const detalhe = primeiro ? await atendimentoDetalhe(l, a.cod, primeiro.reg) : null;
      const impresso = primeiro ? await dadosDoImpresso(l, primeiro.reg) : null;
      const previa = primeiro ? await previaCancelamento(l, a.cod, primeiro.reg) : null;
      const historico = primeiro?.paciente.id ? await historicoAtendimentos(l, primeiro.paciente.id) : null;
      const locais = await locaisDeAtendimento(l);
      const t1 = Date.now();
      let naFila = 0;
      for (const loc of locais.slice(0, 5))
        naFila += (await filaDoLocal(l, a.cod, { local: loc.id, hoje: dia })).itens.length;
      const msFila = Date.now() - t1;
      const pa = await atendimentosPaAbertos(l, a.cod, { hoje: dia });
      const obs = await leitosObservacao(l, a.cod);
      const t2 = Date.now();
      const ind = await indicadoresAtendimento(l, a.cod, { inicio: `${dia.slice(0, 7)}-01`, fim: dia });
      const msInd = Date.now() - t2;
      const apoio = await apoioAtendimento(l);
      const cid = await buscarCid(l, 'R50');
      return {
        dia: dia.length === 10,
        atendimentosDoDia: doDia.itens.length,
        requisicoes: doDia.requisicoes,
        detalheComConta: detalhe !== null && typeof detalhe.conta.situacao === 'string',
        impressoComProntuario: (impresso?.prontuario ?? 0) > 0,
        previaLida: previa !== null,
        historico: (historico?.historico.length ?? 0) > 0,
        locais: locais.length,
        naFila,
        paAbertos: pa.itens.length,
        leitos: obs.leitos.length,
        porTipo: ind.porTipo.length,
        convenios: apoio.convenios.length,
        heranca: Object.keys(apoio.heranca).length,
        cid: cid.length > 0,
        ms: { dia: msDia, fila: msFila, indicadores: msInd },
      };
    });
    expect(r).toMatchObject({
      dia: true,
      detalheComConta: true,
      impressoComProntuario: true,
      previaLida: true,
      historico: true,
      leitos: 12,
      cid: true,
    });
    expect(r.atendimentosDoDia).toBeGreaterThan(0);
    expect(r.heranca).toBeGreaterThanOrEqual(12);
    const m = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
    console.log(
      `[${a.cod}] leituras: ${m(r.atendimentosDoDia)} atendimentos no dia (${m(r.requisicoes)} requisições), ${m(r.locais)} locais, ${m(r.naFila)} nas filas, ${m(r.paAbertos)} PA abertos, ${r.leitos} leitos, ${m(r.porTipo)} grupos nos indicadores do mês; ${r.ms.dia} ms (dia), ${r.ms.fila} ms (5 filas), ${r.ms.indicadores} ms (indicadores)`,
    );
  });

  it('correções da revisão: o desfecho libera o leito e não tem autor administrativo; agendamento e saídas do PA', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const pac = await paciente(e, usuario);
      const ap = await apoioDaFicha(e, { tipoAte: 11 });
      const aberta = await exec('atendimento.abrirAtendimento', {
        tipo: 'pa',
        paciente: pac.id,
        convenio: ap.convenio,
        profissional: ap.profissional,
        especialidade: ap.especialidade,
        unidade: ap.unidade,
        centroCusto: ap.centroCusto,
        procedimento: ap.procedimento,
        carater: 'urgencia',
        cidPrincipal: ap.cid,
      });
      const reg = num(aberta.resultado['reg']);
      const cab = String(aberta.resultado['cabecalho']);
      const [lt] = await e.consultar('SELECT MIN(ID) L FROM RELEITO', [], { teto: 1 });
      await alocarObservacao(e, { hospital: a.cod, cabecalho: cab, reg, leito: num(lt?.['L']), usuario });
      // A evasão (desfecho administrativo) com um vínculo qualquer no corpo: a receita não grava autor.
      await exec('atendimento.encerrarAtendimento', {
        atendimento: reg,
        desfecho: 'evasao',
        profissional: ap.profissional,
      });
      const [d] = await e.consultar(
        `SELECT d.ID_TBCBOPRO V, (SELECT COUNT(*) FROM SGH_PA_OBSERVACAO o WHERE o.HOSPITAL = d.HOSPITAL
            AND o.ID_ATCABECATEND = d.ID_ATCABECATEND AND o.SAIDA_EM IS NULL) ABERTAS
           FROM SGH_ATD_DESFECHO d WHERE d.HOSPITAL = ? AND d.REG = ?`,
        [a.cod, reg],
        { teto: 1 },
      );
      // A ficha aberta de um agendamento (a mais recente da cópia com a marcação ligada): a prévia recusa a exclusão.
      const [ag] = await e.consultar(
        'SELECT FIRST 1 a.ID, a.REGISTRO FROM REPACAGD a JOIN RECADATE r ON r.REG = a.REGISTRO WHERE a.REGISTRO > 0 ORDER BY a.ID DESC',
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const previa = ag ? await previaCancelamento(e, a.cod, num(ag['REGISTRO'])) : null;
      const marcacao = ag ? await marcacaoParaAbertura(e, num(ag['ID'])) : null;
      // Marcações ligadas a ficha que não existe mais (o estado que a exclusão deixaria): o outro sistema nunca deixa.
      const t0 = Date.now();
      const [o] = await e.consultar(
        `SELECT COUNT(*) N FROM REPACAGD a WHERE a.REGISTRO > 0 AND a.DATA >= DATE '2025-10-01'
           AND NOT EXISTS (SELECT 1 FROM RECADATE r WHERE r.REG = a.REGISTRO)`,
        [],
        { teto: 1, tempoMaximoMs: 300_000 },
      );
      const orfas = num(o?.['N']);
      // O que o agendamento traz para a abertura (as marcações atendidas de 2026-06 em diante; só contagens).
      const [pf] = await e.consultar(
        `SELECT COUNT(*) N, SUM(IIF(a.CONV > 0, 1, 0)) CONV, SUM(IIF(a.CRM > 0, 1, 0)) CRM,
            SUM(IIF(a.ESPEC > 0, 1, 0)) ESPEC, SUM(IIF(a.UNIDADE > 0, 1, 0)) UNI, SUM(IIF(a.PROCED > 0, 1, 0)) PROC,
            SUM(IIF(a.CDC > 0, 1, 0)) CDC, SUM(IIF(a.ID_RICADPAC > 0, 1, 0)) PAC,
            SUM(IIF(a.CRM = r.CRM, 1, 0)) CRMFICHA, SUM(IIF(a.ESPEC = r.ESPEC, 1, 0)) ESPECFICHA
           FROM REPACAGD a JOIN RECADATE r ON r.REG = a.REGISTRO
          WHERE a.REGISTRO > 0 AND a.DATA >= DATE '2026-06-01'`,
        [],
        { teto: 1, tempoMaximoMs: 300_000 },
      );
      const perfil = Object.fromEntries(Object.entries(pf ?? {}).map(([k, v]) => [k, num(v)]));
      const msOrfas = Date.now() - t0;
      return {
        autorAdministrativo: d?.['V'] ?? null,
        leitoLivre: num(d?.['ABERTAS']) === 0,
        previaRecusa: previa ? !previa.pode && previa.marcacao === true : null,
        marcacaoPreenche: marcacao
          ? marcacao.registro === num(ag?.['REGISTRO']) && marcacao.convenio > 0
          : null,
        orfas,
        msOrfas,
        perfil,
      };
    });
    expect(r).toMatchObject({
      autorAdministrativo: null,
      leitoLivre: true,
      previaRecusa: true,
      marcacaoPreenche: true,
      orfas: 0,
    });
    expect(await retrato()).toEqual(antes);
    // Saídas do PA pela outra ponta nas 48 horas do último dia de movimento (READ ONLY, só contagens).
    const pa = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [u] = await l.consultar(
        'SELECT CAST(MAX(DT_ATE) AS VARCHAR(10)) D FROM RECADATE WHERE TIPO_ATE = 11',
        [],
        { teto: 1 },
      );
      const t = Date.now();
      const x = await atendimentosPaAbertos(l, a.cod, { hoje: String(u?.['D'] ?? '') });
      return {
        total: x.itens.length,
        liberados: x.itens.filter((i) => i.saida === 'liberado').length,
        alta: x.itens.filter((i) => i.saida === 'alta').length,
        abertos: x.itens.filter((i) => i.saida === null).length,
        ms: Date.now() - t,
      };
    });
    expect(pa.liberados + pa.alta + pa.abertos).toBe(pa.total);
    const m = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
    console.log(
      `[${a.cod}] revisão: ${JSON.stringify({ ...r, perfil: Object.fromEntries(Object.entries(r.perfil).map(([k, v]) => [k, m(v)])) })}; PA nas 48 h: ${m(pa.total)} (${m(pa.abertos)} abertos + ${m(pa.liberados)} liberados do local + ${m(pa.alta)} com alta no cabeçalho), ${pa.ms} ms`,
    );
  });

  it('exceção de gatilho em português; banco externo neutralizado; paciente não identificado e a identificação', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      // O gatilho do leito recusa mudar a chave natural (o escritor do outro sistema tentando): a mensagem da tela.
      const recusado = await outroSistemaTrocaOCodigoDoLeito(e);
      const p = recusado ? problemaDoLegado(recusado).problema : null;
      const traduzido = p?.codigo ?? '';
      const detalheTela = p?.detail ?? '';
      // O cadastro de bancos externos: todos apontando para a própria VM (neutralizado na restauração).
      const [banco] = await e.consultar(
        `SELECT COUNT(*) N, SUM(IIF(CAMINHO CONTAINING '127.0.0.1' OR CAMINHO CONTAINING 'localhost'
            OR TRIM(COALESCE(CAMINHO, '')) = '', 1, 0)) L FROM TBINFBANCO`,
        [],
        { teto: 1 },
      );
      // Paciente não identificado: o cadastro temporário e a marca; depois, a identificação encerra a marca.
      const temp = await paciente(e, usuario);
      const destino = await paciente(e, usuario);
      await marcarNaoIdentificado(e, {
        hospital: a.cod,
        paciente: temp.id,
        prontuario: temp.pront,
        caracteristicas: 'Homem adulto, camisa azul (M20 sintetico)',
        usuario,
      });
      const repetida = await codigo(
        marcarNaoIdentificado(e, {
          hospital: a.cod,
          paciente: temp.id,
          prontuario: temp.pront,
          caracteristicas: 'De novo',
          usuario,
        }),
      );
      const marcados = (await naoIdentificados(e, a.cod)).filter((x) => x.paciente === temp.id);
      await identificarPaciente(e, { hospital: a.cod, paciente: temp.id, destino: destino.id, usuario });
      const depois = (await naoIdentificados(e, a.cod)).filter((x) => x.paciente === temp.id);
      // As gravações só do novo do PA e dos impressos (as tabelas SGH_ do marco), na mesma transação desfeita.
      const [lt] = await e.consultar('SELECT MIN(ID) L FROM RELEITO', [], { teto: 1 });
      const sgh = { hospital: a.cod, cabecalho: '900000001', reg: 900_000_001, usuario };
      const etapa = await gravarEtapaPa(e, { ...sgh, senha: null, etapa: 'exames' });
      const alocada = await alocarObservacao(e, { ...sgh, leito: num(lt?.['L']) });
      const ocupado = await codigo(
        alocarObservacao(e, { ...sgh, reg: 900_000_002, cabecalho: '900000002', leito: num(lt?.['L']) }),
      );
      const saida = await liberarObservacao(e, { ...sgh, justificativa: null, limiteHoras: 24 });
      const impresso = await gravarImpresso(e, {
        hospital: a.cod,
        reg: sgh.reg,
        impresso: 'pulseira',
        formato: 'zpl',
        copias: 1,
        resumo: 'a'.repeat(64),
        usuario,
      });
      return {
        traduzido,
        emPortugues: /não muda/.test(detalheTela),
        bancosExternos: num(banco?.['N']),
        neutralizados: num(banco?.['L']),
        repetida,
        marcado: marcados.length === 1 && marcados[0]?.identificadoEm === null,
        identificado: depois.every((x) => x.identificadoEm !== null),
        sghPa: etapa > 0 && alocada > 0 && impresso > 0,
        leitoOcupado: ocupado,
        horasNaSaida: saida.horas,
      };
    });
    expect(r).toEqual({
      traduzido: 'chave-imutavel',
      emPortugues: true,
      bancosExternos: r.neutralizados,
      neutralizados: r.bancosExternos,
      repetida: 'ja-marcado',
      marcado: true,
      identificado: true,
      sghPa: true,
      leitoOcupado: 'leito-ocupado',
      horasNaSaida: 0,
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] gatilho, banco externo e não identificado: ${JSON.stringify(r)}`);
  });
});
