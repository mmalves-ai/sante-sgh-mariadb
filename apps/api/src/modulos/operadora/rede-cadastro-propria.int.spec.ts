// Contrato de efeito do cadastro complementar do prestador da rede (08-SGO L101, C2-118) contra o MariaDB real
// (cliente f22_o2). Massa SINTÉTICA (documentos com os dígitos calculados). Prova o que fica no banco: a contratação
// indireta com a operadora intermediária; os locais de atendimento (um só principal, recusa do CEP inválido, o
// desligamento com data e motivo que nunca apaga e que espera as especialidades do local); as especialidades por local
// (recusa da repetida e do RQE ausente para divulgar a pessoa física; encerrada, nunca apagada); a qualificação
// divulgada pelo atributo do catálogo (recusa do que não se aplica e do repetido; encerrada pela data de fim); a
// suspensão (recusa da sobreposta; a programada cancelada; a ativa reativada); o registro do descredenciamento com o
// aviso e o substituto (o substituto suspenso é recusado) e a reinclusão que o marca como cancelado; o escopo do
// estabelecimento (404 no outro). SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { cnpjSintetico, cpfSintetico, criticasAutomaticas, suspensaoNaData } from '@sgh/dominio-operadora';
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  PODE,
  prepararBase,
} from './infra/copia.spec-util.js';
import { PortaRedeCadastroPropria } from './rede-cadastro-propria.js';
import type { CamposPrestador, GravacaoRede, GravadorRede } from './rede-porta.js';
import { PortaRedeOperadoraPropria } from './rede-porta-propria.js';

const COD = 'C2118';
const daqui = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const campos = (nome: string, extra: Partial<CamposPrestador> = {}): CamposPrestador => ({
  nome,
  nomeFantasia: null,
  cnes: '9021181',
  uf: 'SP',
  municipioIbge: 3550308,
  tipo: 3,
  natureza: 1,
  classificacao: 1,
  contratacao: 1,
  operadoraIntermediaria: null,
  disponibilidade: 1,
  isencaoOnus: 1,
  urgencia: true,
  regime: 2,
  remuneracao: 1,
  contrato: {
    numero: `${COD}-${nome.slice(-2)}`,
    inicio: '2026-01-01',
    fim: null,
    formaReajuste: 1,
    mesReajuste: 6,
  },
  ehOHospital: false,
  estabelecimento: null,
  convenio: null,
  ...extra,
});

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let rede: PortaRedeOperadoraPropria | null = null;
let porta: PortaRedeCadastroPropria | null = null;
let atributoHospital = 0;
let atributoPf = 0;
let especialidades: number[] = [];

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.rede' },
    correlacao: 'teste-c2118',
  });
const q = (sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c2118' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  );
const gravarRede = <T extends GravacaoRede>(fn: (g: GravadorRede) => Promise<T>) =>
  rede!.gravar(contexto(massa!), trilha('teste.c2118.rede'), fn);

async function limparAtributos(n: NucleoProprio) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2118' }, async (e) => {
    await e.executar(
      `DELETE q FROM qualificacao_prestador_rede q JOIN atributo_qualificacao_rede a ON a.id = q.atributo_qualificacao_rede_id WHERE a.codigo_ans LIKE ?`,
      [`${COD}%`],
    );
    await e.executar('DELETE FROM atributo_qualificacao_rede WHERE codigo_ans LIKE ?', [`${COD}%`]);
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limparMassa(nucleo, massa);
  await limparAtributos(nucleo);
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2118' }, async (e) => {
    const agora = new Date();
    const pj = await e.inserir(
      'INSERT INTO pessoa_juridica (cnpj, razao_social, criado_em) VALUES (?, ?, ?)',
      [cnpjSintetico('902118000201'), 'OPERADORA SINTETICA C2118', agora],
    );
    const ope = await e.inserir(
      `INSERT INTO operadora_saude (pessoa_juridica_id, nome, registro_ans, modalidade, segmentacao, criado_em)
       VALUES (?, 'OPERADORA C2118', '902118', 'medicina_grupo', 'medico_hospitalar', ?)`,
      [pj, agora],
    );
    await e.inserir(
      'INSERT INTO operadora_saude_estabelecimento (operadora_saude_id, estabelecimento_id, principal, vigencia_inicio, criado_em) VALUES (?, ?, TRUE, ?, ?)',
      [ope, massa?.est, '2020-01-01', agora],
    );
    atributoHospital = await e.inserir(
      `INSERT INTO atributo_qualificacao_rede (codigo_ans, descricao, sigla, aplica_hospital, aplica_pessoa_juridica, vigencia_inicio, versao_fonte, criado_em)
       VALUES (?, 'ACREDITACAO SINTETICA', 'A', TRUE, TRUE, '2020-01-01', 'teste', ?)`,
      [`${COD}A`, agora],
    );
    atributoPf = await e.inserir(
      `INSERT INTO atributo_qualificacao_rede (codigo_ans, descricao, sigla, aplica_pessoa_fisica, vigencia_inicio, versao_fonte, criado_em)
       VALUES (?, 'TITULO SINTETICO', 'T', TRUE, '2020-01-01', 'teste', ?)`,
      [`${COD}T`, agora],
    );
  });
  especialidades = (
    await q('SELECT id FROM especialidade_medica WHERE ativo = TRUE ORDER BY id LIMIT 2')
  ).map((x) => Number(x['id']));
  rede = new PortaRedeOperadoraPropria(nucleo, CLIENTE);
  porta = new PortaRedeCadastroPropria(nucleo, CLIENTE);
}, 120_000);

afterAll(async () => {
  if (!nucleo) return;
  if (massa) await limparMassa(nucleo, massa);
  await limparAtributos(nucleo);
  await nucleo.encerrar();
});

const local = (extra: Record<string, unknown> = {}) => ({
  nome: 'Unidade Centro',
  cnes: '9021181',
  cep: '01310-100',
  logradouro: 'Avenida Sintética',
  numero: '100',
  complemento: null,
  bairro: 'Centro',
  municipioIbge: 3550308,
  latitude: -23.56,
  longitude: -46.65,
  telefone: null,
  email: null,
  acessivelCadeirante: true,
  estacionamento: false,
  principal: true,
  divulga: true,
  ...extra,
});
const especialidade = (esp: number, loc: number | null, extra: Record<string, unknown> = {}) => ({
  especialidade: esp,
  local: loc,
  ambulatorio: true,
  internacao: false,
  urgencia: false,
  hospitalDia: false,
  adulto: true,
  pediatrico: false,
  rqe: null,
  principal: false,
  divulga: true,
  ...extra,
});

describe.skipIf(!PODE)('cadastro complementar do prestador da rede (banco)', () => {
  it('contratação indireta, locais, especialidades, qualificação, suspensão e o registro do descredenciamento', async () => {
    const c = contexto(massa!);
    const p = porta!;
    expect(especialidades.length).toBe(2);
    // Contratação indireta: grava a intermediária e o contrato indireto; sem a intermediária, recusa.
    expect(
      await codigoDe(
        gravarRede((g) =>
          g.credenciar({
            ...campos('HOSPITAL C2118 X1'),
            contratacao: 2,
            pessoa: 'J',
            documento: cnpjSintetico('902118000301'),
            usuario: 'x',
          }),
        ),
      ),
    ).toBeTruthy();
    const hosp = await gravarRede((g) =>
      g.credenciar({
        ...campos('HOSPITAL C2118 H1'),
        contratacao: 2,
        operadoraIntermediaria: '902118',
        pessoa: 'J',
        documento: cnpjSintetico('902118000401'),
        usuario: 'x',
      }),
    );
    const [ph] = await q(
      `SELECT p.contratacao, p.operadora_intermediaria_registro_ans AS inter, k.relacao
         FROM prestador_rede p JOIN contrato_rede_prestador k ON k.prestador_rede_id = p.id WHERE p.id = ?`,
      [hosp.id],
    );
    expect(ph).toMatchObject({ contratacao: 'indireta', inter: '902118', relacao: 'indireta' });
    const medico = await gravarRede((g) =>
      g.credenciar({
        ...campos('MEDICO C2118 M1', { cnes: null, classificacao: 3 }),
        pessoa: 'F',
        documento: cpfSintetico('902118401'),
        usuario: 'x',
      }),
    );

    // Locais: o primeiro é principal; o segundo principal passa o anterior a não principal; CEP inválido recusa.
    const l1 = await p.incluirLocal(c, hosp.id, local(), trilha('l1'));
    const l2 = await p.incluirLocal(
      c,
      hosp.id,
      local({ nome: 'Unidade Sul', cep: '04000000' }),
      trilha('l2'),
    );
    expect(await codigoDe(p.incluirLocal(c, hosp.id, local({ cep: '123' }), trilha('x')))).toBe(
      'cep-invalido',
    );
    let ficha = await p.ficha(c, hosp.id);
    expect(ficha.locais.map((x) => [x.nome, x.principal, x.cep])).toEqual([
      ['Unidade Sul', true, '04000000'],
      ['Unidade Centro', false, '01310100'],
    ]);

    // Especialidades: por local; a repetida recusa; a pessoa física divulgada sem RQE recusa.
    const e1 = await p.incluirEspecialidade(
      c,
      hosp.id,
      especialidade(especialidades[0]!, l1.id),
      trilha('e1'),
    );
    await p.incluirEspecialidade(
      c,
      hosp.id,
      especialidade(especialidades[1]!, null, { urgencia: true }),
      trilha('e2'),
    );
    expect(
      await codigoDe(
        p.incluirEspecialidade(c, hosp.id, especialidade(especialidades[0]!, l1.id), trilha('x')),
      ),
    ).toBe('especialidade-repetida');
    expect(
      await codigoDe(
        p.incluirEspecialidade(c, medico.id, especialidade(especialidades[0]!, null), trilha('x')),
      ),
    ).toBe('rqe-obrigatorio-para-divulgar');
    await p.incluirEspecialidade(
      c,
      medico.id,
      especialidade(especialidades[0]!, null, { rqe: '12345' }),
      trilha('e3'),
    );

    // Desligar o local com especialidade ativa recusa; encerrada a especialidade, desliga (a linha fica).
    const lFicha = (await p.ficha(c, hosp.id)).locais.find((x) => x.id === l1.id)!;
    const desl = { desligadoEm: daqui(0), motivo: 'Unidade fechada pelo prestador' };
    expect(await codigoDe(p.desligarLocal(c, l1.id, lFicha.versao, desl, trilha('x')))).toBe(
      'local-com-especialidades',
    );
    await p.encerrarEspecialidade(c, e1.id, 1, trilha('e1-fim'));
    const v = (await p.ficha(c, hosp.id)).locais.find((x) => x.id === l1.id)!.versao;
    await p.desligarLocal(c, l1.id, v, desl, trilha('l1-fim'));
    const [ld] = await q(
      'SELECT ativo, desligado_em IS NOT NULL AS d, motivo_desligamento AS m FROM local_atendimento_rede WHERE id = ?',
      [l1.id],
    );
    expect(ld).toMatchObject({ ativo: 0, d: 1, m: 'Unidade fechada pelo prestador' });
    const [ee] = await q('SELECT situacao FROM especialidade_atendida_rede WHERE id = ?', [e1.id]);
    expect(ee?.['situacao']).toBe('encerrada');

    // Qualificação: aplicável ao hospital; o atributo de pessoa física não; a repetida não; encerrada pela data.
    const qual = {
      atributo: atributoHospital,
      nivel: 'pleno',
      titulo: null,
      divulga: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    const q1 = await p.incluirQualificacao(c, hosp.id, qual, trilha('q1'));
    expect(
      await codigoDe(p.incluirQualificacao(c, hosp.id, { ...qual, atributo: atributoPf }, trilha('x'))),
    ).toBe('atributo-nao-aplica');
    expect(await codigoDe(p.incluirQualificacao(c, hosp.id, qual, trilha('x')))).toBe(
      'qualificacao-repetida',
    );
    ficha = await p.ficha(c, hosp.id);
    expect(ficha.qualificacoes.map((x) => [x.codigoAtributo, x.vigente])).toEqual([[`${COD}A`, true]]);
    await p.encerrarQualificacao(c, q1.id, 1, daqui(0), trilha('q1-fim'));
    const [qd] = await q(
      'SELECT vigencia_fim IS NOT NULL AS f FROM qualificacao_prestador_rede WHERE id = ?',
      [q1.id],
    );
    expect(qd?.['f']).toBe(1);

    // Suspensão: a do local 2 ativa; a do prestador inteiro sobreposta recusa; reativada hoje, encerra.
    const s1 = await p.suspender(
      c,
      hosp.id,
      { motivo: 'auditoria', local: l2.id, desde: daqui(0), reativacaoPrevista: null, observacao: null },
      trilha('s1'),
    );
    expect(s1.situacao).toBe('ativa');
    expect(
      await codigoDe(
        p.suspender(
          c,
          hosp.id,
          { motivo: 'qualidade', local: null, desde: daqui(0), reativacaoPrevista: null, observacao: null },
          trilha('x'),
        ),
      ),
    ).toBe('suspensao-aberta');
    expect((await p.reativar(c, s1.id, 1, daqui(0), trilha('s1-fim'))).situacao).toBe('encerrada');
    // A programada do prestador inteiro: cancelada pela reativação antes de começar.
    const s2 = await p.suspender(
      c,
      hosp.id,
      {
        motivo: 'pedido_prestador',
        local: null,
        desde: daqui(10),
        reativacaoPrevista: daqui(20),
        observacao: null,
      },
      trilha('s2'),
    );
    expect(s2.situacao).toBe('programada');
    expect((await p.reativar(c, s2.id, 1, daqui(0), trilha('s2-fim'))).situacao).toBe('cancelada');
    const susp = await q(
      'SELECT situacao FROM suspensao_prestador_rede WHERE prestador_rede_id = ? ORDER BY id',
      [hosp.id],
    );
    expect(susp.map((x) => x['situacao'])).toEqual(['encerrada', 'cancelada']);

    // Descredenciamento: o substituto suspenso é recusado; com o substituto credenciado, o registro próprio fica
    // agendado com o aviso, e a reinclusão antes da data o marca como cancelado.
    const sub = await gravarRede((g) =>
      g.credenciar({
        ...campos('HOSPITAL C2118 S1'),
        pessoa: 'J',
        documento: cnpjSintetico('902118000501'),
        usuario: 'x',
      }),
    );
    const s3 = await p.suspender(
      c,
      sub.id,
      { motivo: 'auditoria', local: null, desde: daqui(0), reativacaoPrevista: null, observacao: null },
      trilha('s3'),
    );
    // A suspensão vale na autorização: a leitura do prestador (a mesma que a autorização usa) traz a suspensão do
    // prestador inteiro, e a crítica do pedido bloqueia; a do local (s1, já encerrada) não entra.
    const criticaDe = async (id: number) => {
      const lido = (await rede!.prestador(c, id))!;
      return criticasAutomaticas({
        elegibilidade: { elegivel: true, motivos: [], carencias: [] } as never,
        produto: { natureza: 'plano', segmentacao: null },
        pedido: { carater: 'E', tipoGuia: 2, internacaoTipo: null, comGuiaPrincipal: false },
        prestador: {
          situacao: lido.situacao,
          regime: 3,
          suspenso: suspensaoNaData(lido.suspensoes ?? [], daqui(0)) !== null,
        },
      }).map((x) => x.codigo);
    };
    expect((await rede!.prestador(c, hosp.id))!.suspensoes).toEqual([]);
    expect(await criticaDe(sub.id)).toContain('prestador-suspenso');
    const pedido = {
      id: hosp.id,
      versao: 1,
      motivo: 'Pedido do prestador por encerramento',
      efetivoEm: daqui(30),
      avisoBeneficiariosEm: daqui(0),
      substituto: sub.id,
      autorizacaoAns: null,
      tipoMotivo: 'pedido_prestador' as const,
      usuario: 'x',
    };
    expect(await codigoDe(gravarRede((g) => g.descredenciar(pedido)))).toBe('substituto-suspenso');
    // Reativado hoje: a autorização volta a aceitar o prestador.
    expect((await p.reativar(c, s3.id, 1, daqui(0), trilha('s3-fim'))).situacao).toBe('encerrada');
    expect(await criticaDe(sub.id)).not.toContain('prestador-suspenso');
    const sub2 = await gravarRede((g) =>
      g.credenciar({
        ...campos('HOSPITAL C2118 S2'),
        pessoa: 'J',
        documento: cnpjSintetico('902118000601'),
        usuario: 'x',
      }),
    );
    // Equivalência: sem as especialidades do hospital que sai, recusa; com elas (e no mesmo município), aceita.
    expect(await codigoDe(gravarRede((g) => g.descredenciar({ ...pedido, substituto: sub2.id })))).toBe(
      'substituto-sem-especialidade',
    );
    await p.incluirEspecialidade(c, sub2.id, especialidade(especialidades[0]!, null), trilha('e-s2a'));
    await p.incluirEspecialidade(c, sub2.id, especialidade(especialidades[1]!, null), trilha('e-s2b'));
    const lSub = await p.incluirLocal(
      c,
      sub2.id,
      local({ municipioIbge: 3304557, cep: '20040002' }),
      trilha('l-s2'),
    );
    expect(await codigoDe(gravarRede((g) => g.descredenciar({ ...pedido, substituto: sub2.id })))).toBe(
      'substituto-fora-do-municipio',
    );
    await p.incluirLocal(c, sub2.id, local({ nome: 'Unidade Paulista', principal: false }), trilha('l-s2b'));
    expect(lSub.id).toBeGreaterThan(0);
    const d = await gravarRede((g) => g.descredenciar({ ...pedido, substituto: sub2.id }));
    ficha = await p.ficha(c, hosp.id);
    expect(ficha.descredenciamentos).toHaveLength(1);
    expect(ficha.descredenciamentos[0]).toMatchObject({
      tipoMotivo: 'pedido_prestador',
      situacao: 'agendado',
      substituto: sub2.id,
      nomeSubstituto: 'HOSPITAL C2118 S2',
      efetivoEm: daqui(30),
      avisoBeneficiariosEm: daqui(0),
    });
    await gravarRede((g) =>
      g.reincluir({
        id: hosp.id,
        versao: d.versao,
        motivo: 'Prestador desistiu da saída',
        contrato: campos('HOSPITAL C2118 H1').contrato,
        usuario: 'x',
      }),
    );
    const [dr] = await q(
      'SELECT situacao, cancelado_em IS NOT NULL AS c FROM descredenciamento_prestador WHERE prestador_rede_id = ?',
      [hosp.id],
    );
    expect(dr).toMatchObject({ situacao: 'cancelado', c: 1 });

    // Trilha na mesma transação e o escopo do estabelecimento.
    const [t] = await q(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'local_atendimento_rede' AND entidade_id = ?",
      [l1.id],
    );
    expect(Number(t?.['n'])).toBeGreaterThanOrEqual(1);
    expect(await codigoDe(p.ficha(contexto(massa!, true), hosp.id))).toBe('nao-encontrado');
  }, 120_000);
});
