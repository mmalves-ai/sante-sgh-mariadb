// Contrato de efeito dos dados demográficos do paciente (F3.1, 02-CAD linha 15) contra o MariaDB real, no cliente de
// teste, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real): o que a gravação deixa na pessoa
// e no cadastro do paciente, as recusas da regra (nome social, povo indígena, capacidade civil sem responsável, opção
// fora do vocabulário) sem nada gravado, e a vulnerabilidade declarada e encerrada sem apagar. Os vocabulários vêm das
// sementes do produto (db/sementes/03_cadastro_demografia.json); o povo e a língua indígena do teste são sintéticos e
// saem no fim. Atributos do cadastro nacional (09-AREA linha 73): orientação sexual, situação familiar, língua indígena
// e a doença crônica declarada (migração 03_CAD/97_condicao_cronica_declarada).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemografiaPacientePropria, type EntradaDemografia } from './demografia-paciente-propria.js';
import { FichaComplementarPropria } from './ficha-complementar-proprio.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const NOME = `DEMOG ${MARCA}`;
const CPF_ADULTA = cpfSintetico('990102371');
const CPF_MENOR = cpfSintetico('990102372');
const CPF_MAE = cpfSintetico('990102373');
/** Código sintético do povo indígena do teste (fora da faixa da tabela oficial). */
const ETNIA_TESTE = 'T3107';

async function limparDemografia(nucleo: NucleoProprio): Promise<void> {
  const pacientes = `SELECT id FROM (SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                      WHERE pf.nome LIKE ?) x`;
  const marca = [`%${NOME}%`];
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f31-07-demog-limpa' }, async (e) => {
    await e.executar(`DELETE FROM paciente_vulnerabilidade WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(`DELETE FROM paciente_condicao_cronica WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(`UPDATE paciente SET idioma_indigena_id = NULL WHERE id IN (${pacientes})`, marca);
    await e.executar('DELETE FROM idioma_indigena WHERE codigo_cadsus = ?', [ETNIA_TESTE]);
    await e.executar(`DELETE FROM responsavel_paciente WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(`UPDATE paciente SET povo_indigena_id = NULL WHERE id IN (${pacientes})`, marca);
    await e.executar('UPDATE pessoa_fisica SET povo_indigena_id = NULL WHERE nome LIKE ?', marca);
    await e.executar('DELETE FROM povo_indigena WHERE codigo_etnia_sus = ?', [ETNIA_TESTE]);
  });
}

describe.skipIf(SEM_BANCO)('dados demográficos do paciente no banco próprio', () => {
  let nucleo: NucleoProprio;
  let demografia: DemografiaPacientePropria;
  let ficha: FichaComplementarPropria;
  let m: Massa | null = null;
  let adulta = 0;
  let menor = 0;
  let povo = 0;
  let idioma = 0;
  let vazio: EntradaDemografia;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f31-07-demog-conta' }, (l) => l.uma<T>(sql, p));
  const contar = async (sql: string, p: readonly unknown[]) => Number((await um(sql, p))?.['n'] ?? -1);
  const idDe = async (tabela: string, coluna: string, codigo: string) =>
    Number((await um(`SELECT id FROM ${tabela} WHERE ${coluna} = ?`, [codigo]))?.['id'] ?? 0);
  const trilha = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.demografia-paciente' },
    correlacao: 'f31-07-demog',
  });
  const c = () => contextoPorta(m!, 'f31-07-demog');
  const codigo = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'gravou',
      (x: { problema?: { codigo?: string }; codigo?: string; tipo?: string }) =>
        x.problema?.codigo ?? x.codigo ?? x.tipo ?? String(x),
    );
  const gravar = (e: Partial<EntradaDemografia> & { paciente: number }) =>
    demografia.gravar(c(), { ...vazio, ...e }, trilha('paciente'));
  /** O que ficou na pessoa e no cadastro do paciente (só ids e marcas; nenhum dado de pessoa real). */
  const noBanco = (paciente: number) =>
    um(
      `SELECT pf.usa_nome_social AS pf_usa, pf.nome_social AS pf_social, p.usa_nome_social AS p_usa,
              p.nome_social AS p_social, pf.identidade_de_genero_id AS pf_genero, p.identidade_de_genero_id AS p_genero,
              pf.classificacao_raca_cor_id AS pf_raca, p.classificacao_raca_cor_id AS p_raca,
              pf.povo_indigena_id AS pf_povo, p.povo_indigena_id AS p_povo,
              pf.nivel_escolaridade_id AS pf_escola, p.nivel_escolaridade_id AS p_escola,
              pf.crenca_religiosa_id AS pf_religiao, p.crenca_religiosa_id AS p_religiao,
              pf.nacionalidade_id AS pf_nac, p.nacionalidade_id AS p_nac,
              pf.pais_nascimento_id AS pf_pais, p.nascimento_pais_referencia_id AS p_pais,
              pf.ocupacao_cbo_id AS pf_ocupacao, p.ocupacao_cbo_id AS p_ocupacao,
              pf.orientacao_sexual_declarada_id AS pf_orientacao, p.orientacao_sexual_declarada_id AS p_orientacao,
              pf.situacao_convivio_familiar_id AS pf_familia, p.situacao_convivio_familiar_id AS p_familia,
              p.idioma_indigena_id AS p_idioma,
              p.capacidade_civil_id AS p_capacidade, pf.versao AS pf_versao, p.versao AS p_versao
         FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
      [paciente],
    );
  const trilhas = (paciente: number) =>
    contar(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'paciente' AND entidade_id = ?
          AND correlacao = 'f31-07-demog'`,
      [paciente],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    await limparDemografia(nucleo);
    await limparMassa(nucleo, m);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const paciente = async (nome: string, nascimento: string, cpf: string) =>
      (
        await cadastro.cadastrar(
          contextoPorta(m!),
          {
            nome,
            nascimento,
            sexo: 'F',
            cpf,
            naturalidade: 'BELO HORIZONTE',
            ufNaturalidade: 'MG',
            cep: CEP_TESTE,
            numero: 10,
          },
          contextoGravacao(m!),
        )
      ).resultado.idPaciente;
    adulta = await paciente(`ADULTA ${NOME}`, '1980-05-17', CPF_ADULTA);
    menor = await paciente(`MENOR ${NOME}`, '2016-03-02', CPF_MENOR);
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f31-07-demog-povo' }, async (e) => {
      povo = await e.inserir(
        'INSERT INTO povo_indigena (codigo_etnia_sus, descricao, criado_em) VALUES (?, ?, ?)',
        [ETNIA_TESTE, `POVO SINTETICO ${MARCA}`, new Date()],
      );
      idioma = await e.inserir(
        'INSERT INTO idioma_indigena (codigo_cadsus, descricao, criado_em) VALUES (?, ?, ?)',
        [ETNIA_TESTE, `LINGUA SINTETICA ${MARCA}`, new Date()],
      );
    });
    demografia = new DemografiaPacientePropria(nucleo, CLIENTE_F22);
    ficha = new FichaComplementarPropria(nucleo, CLIENTE_F22);
    vazio = {
      paciente: 0,
      usaNomeSocial: false,
      nomeSocial: null,
      identidadeGenero: null,
      racaCor: null,
      povoIndigena: null,
      escolaridade: null,
      religiao: null,
      nacionalidade: null,
      paisNascimento: null,
      capacidadeCivil: null,
      orientacaoSexual: null,
      situacaoFamiliar: null,
      idiomaIndigena: null,
      ocupacao: null,
    };
  }, 180_000);

  afterAll(async () => {
    await limparDemografia(nucleo).catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('leitura: os vocabulários das sementes chegam à tela, com a marca que a regra usa', async () => {
    const d = await demografia.demografia(c(), adulta);
    expect(d.usaNomeSocial).toBe(false);
    expect(d.racaCor).toBeNull();
    expect(d.vulnerabilidades).toEqual([]);
    expect(d.opcoes.racaCor.length).toBeGreaterThanOrEqual(6);
    expect(d.opcoes.racaCor.filter((o) => o.marca).map((o) => o.descricao)).toEqual(['Indígena']);
    expect(d.opcoes.capacidadeCivil.filter((o) => o.marca).length).toBeGreaterThanOrEqual(2);
    for (const k of ['identidadeGenero', 'escolaridade', 'religiao', 'nacionalidade'] as const)
      expect(d.opcoes[k].length).toBeGreaterThan(0);
    expect(d.opcoes.condicoesVulnerabilidade.length).toBeGreaterThan(0);
    expect(d.opcoes.povoIndigena.some((o) => o.id === povo)).toBe(true);
    expect(d.opcoes.informantes).toContain('servico_social');
    // Cadastro nacional: orientação sexual opcional com "não quis declarar" por último, situação familiar pelo código
    // oficial, doenças crônicas por CID-10 e a língua indígena em uso.
    expect(d.opcoes.orientacaoSexual.length).toBeGreaterThanOrEqual(8);
    expect(d.opcoes.orientacaoSexual.at(-1)?.descricao).toBe('Não quis declarar');
    expect(d.opcoes.situacaoFamiliar.length).toBeGreaterThanOrEqual(7);
    expect(d.opcoes.condicoesCronicas.length).toBeGreaterThanOrEqual(18);
    expect(d.opcoes.condicoesCronicas.some((o) => o.descricao.endsWith('(I10)'))).toBe(true);
    expect(d.opcoes.idiomaIndigena.some((o) => o.id === idioma)).toBe(true);
    expect([d.orientacaoSexual, d.situacaoFamiliar, d.idiomaIndigena, d.condicoesCronicas]).toEqual([
      null,
      null,
      null,
      [],
    ]);
    expect(await codigo(demografia.demografia(c(), 999_999_999))).toBe('paciente-inexistente');
  });

  it('gravação: a pessoa e o cadastro do paciente ficam com a mesma escolha, com trilha', async () => {
    const genero = await idDe('identidade_de_genero', 'codigo', 'mulher_transgenero');
    const raca = await idDe('classificacao_raca_cor', 'codigo_ibge', '4');
    const escola = await idDe('nivel_escolaridade', 'codigo', 'medio_completo');
    const religiao = await idDe('crenca_religiosa', 'codigo', 'sem_religiao');
    const nac = await idDe('nacionalidade', 'codigo_cadsus', '1');
    const capacidade = await idDe('capacidade_civil', 'codigo', 'plena');
    const pais = Number((await um('SELECT MIN(id) AS id FROM pais_referencia', []))?.['id'] ?? 0);
    const orientacao = await idDe('orientacao_sexual_declarada', 'codigo', 'nao_declarado');
    const familia = await idDe('situacao_convivio_familiar', 'codigo_esus', '6');
    expect([orientacao, familia].every((x) => x > 0)).toBe(true);
    const busca = await demografia.ocupacoes(c(), 'enferm');
    expect(busca.itens.length).toBeGreaterThan(0);
    expect(busca.itens.length).toBeLessThanOrEqual(20);
    expect((await demografia.ocupacoes(c(), 'en')).itens).toEqual([]);
    const ocupacao = busca.itens[0]!.id;
    expect([genero, raca, escola, religiao, nac, capacidade, pais].every((x) => x > 0)).toBe(true);
    const antes = await noBanco(adulta);
    const t0 = await trilhas(adulta);
    await gravar({
      paciente: adulta,
      usaNomeSocial: true,
      nomeSocial: `  SOCIAL   ${NOME} `,
      identidadeGenero: genero,
      racaCor: raca,
      escolaridade: escola,
      religiao,
      nacionalidade: nac,
      paisNascimento: pais,
      capacidadeCivil: capacidade,
      orientacaoSexual: orientacao,
      situacaoFamiliar: familia,
      ocupacao,
    });
    const x = (await noBanco(adulta))!;
    expect([Number(x['pf_usa']), Number(x['p_usa'])]).toEqual([1, 1]);
    expect([x['pf_social'], x['p_social']]).toEqual([`SOCIAL ${NOME}`, `SOCIAL ${NOME}`]);
    for (const [campo, id] of [
      ['genero', genero],
      ['raca', raca],
      ['escola', escola],
      ['religiao', religiao],
      ['nac', nac],
      ['pais', pais],
      ['ocupacao', ocupacao],
      ['orientacao', orientacao],
      ['familia', familia],
    ] as const)
      expect([campo, Number(x[`pf_${campo}`]), Number(x[`p_${campo}`])]).toEqual([campo, id, id]);
    expect([x['pf_povo'], x['p_povo'], x['p_idioma']]).toEqual([null, null, null]);
    expect(Number(x['p_capacidade'])).toBe(capacidade);
    expect(Number(x['pf_versao'])).toBe(Number(antes!['pf_versao']) + 1);
    expect(Number(x['p_versao'])).toBe(Number(antes!['p_versao']) + 1);
    expect(await trilhas(adulta)).toBe(t0 + 1);
    const d = await demografia.demografia(c(), adulta);
    expect([
      d.usaNomeSocial,
      d.nomeSocial,
      d.racaCor,
      d.ocupacao?.id,
      d.orientacaoSexual,
      d.situacaoFamiliar,
    ]).toEqual([true, `SOCIAL ${NOME}`, raca, ocupacao, orientacao, familia]);
    // Deixar de usar o nome social guarda o nome (a pessoa pode voltar a usar) e limpa o que saiu da tela.
    await gravar({ paciente: adulta, nomeSocial: `SOCIAL ${NOME}`, racaCor: raca });
    const y = (await noBanco(adulta))!;
    expect([
      Number(y['pf_usa']),
      y['pf_social'],
      y['pf_genero'],
      y['p_capacidade'],
      y['pf_orientacao'],
      y['p_orientacao'],
    ]).toEqual([0, `SOCIAL ${NOME}`, null, null, null, null]);
  });

  it('recusas da regra: nome social, povo indígena e opção fora do vocabulário, sem nada gravado', async () => {
    const indigena = await idDe('classificacao_raca_cor', 'codigo_ibge', '5');
    const parda = await idDe('classificacao_raca_cor', 'codigo_ibge', '4');
    const antes = await noBanco(adulta);
    const t0 = await trilhas(adulta);
    expect(await codigo(gravar({ paciente: adulta, usaNomeSocial: true }))).toBe('nome-social-exigido');
    expect(
      await codigo(
        gravar({ paciente: adulta, usaNomeSocial: true, nomeSocial: `adulta ${NOME.toLowerCase()}` }),
      ),
    ).toBe('nome-social-igual-ao-nome');
    expect(await codigo(gravar({ paciente: adulta, racaCor: indigena }))).toBe('povo-indigena-exigido');
    expect(await codigo(gravar({ paciente: adulta, racaCor: parda, povoIndigena: povo }))).toBe(
      'povo-indigena-indevido',
    );
    expect(await codigo(gravar({ paciente: adulta, povoIndigena: povo }))).toBe('povo-indigena-indevido');
    expect(await codigo(gravar({ paciente: adulta, racaCor: 999_999_999 }))).toBe('opcao-invalida');
    expect(await codigo(gravar({ paciente: adulta, ocupacao: 999_999_999 }))).toBe('opcao-invalida');
    expect(await codigo(gravar({ paciente: adulta, racaCor: parda, idiomaIndigena: idioma }))).toBe(
      'idioma-indigena-indevido',
    );
    expect(await codigo(gravar({ paciente: adulta, orientacaoSexual: 999_999_999 }))).toBe('opcao-invalida');
    expect(await codigo(gravar({ paciente: adulta, situacaoFamiliar: 999_999_999 }))).toBe('opcao-invalida');
    expect(await noBanco(adulta)).toEqual(antes);
    expect(await trilhas(adulta)).toBe(t0);
    // A raça/cor indígena com o povo grava nos dois lugares; a língua indígena é do cadastro do paciente.
    await gravar({ paciente: adulta, racaCor: indigena, povoIndigena: povo, idiomaIndigena: idioma });
    const x = (await noBanco(adulta))!;
    expect(Number(x['p_idioma'])).toBe(idioma);
    expect((await demografia.demografia(c(), adulta)).idiomaIndigena).toBe(idioma);
    expect([Number(x['pf_raca']), Number(x['p_raca']), Number(x['pf_povo']), Number(x['p_povo'])]).toEqual([
      indigena,
      indigena,
      povo,
      povo,
    ]);
  });

  it('capacidade civil que exige responsável legal só grava com o responsável vigente', async () => {
    const incapaz = await idDe('capacidade_civil', 'codigo', 'absolutamente_incapaz');
    expect((await demografia.demografia(c(), menor)).temRepresentanteVigente).toBe(false);
    expect(await codigo(gravar({ paciente: menor, capacidadeCivil: incapaz }))).toBe(
      'capacidade-sem-responsavel',
    );
    expect((await noBanco(menor))!['p_capacidade']).toBeNull();
    await ficha.incluirResponsavel(
      c(),
      {
        paciente: menor,
        cpf: CPF_MAE,
        nome: `MAE ${NOME}`,
        nascimento: '1985-01-01',
        papel: 'responsavel_legal',
        parentesco: null,
        autorizarProcedimento: true,
        receberInformacao: true,
        retirarDocumento: false,
        contatoPrincipal: false,
        prioridadeContato: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        comprovante: null,
        observacao: null,
      },
      trilha('responsavel_paciente'),
    );
    expect((await demografia.demografia(c(), menor)).temRepresentanteVigente).toBe(true);
    await gravar({ paciente: menor, capacidadeCivil: incapaz });
    expect(Number((await noBanco(menor))!['p_capacidade'])).toBe(incapaz);
  });

  it('vulnerabilidade: declarada com data e informante, uma vigente por condição, encerrada sem apagar', async () => {
    const d = await demografia.demografia(c(), adulta);
    const condicao = d.opcoes.condicoesVulnerabilidade[0]!.id;
    const nova = {
      paciente: adulta,
      condicao,
      declaradaEm: '2026-10-01',
      informanteTipo: 'servico_social',
      informanteNome: null,
      observacao: null,
    };
    const t = trilha('paciente_vulnerabilidade');
    const linhas = () =>
      contar('SELECT COUNT(*) AS n FROM paciente_vulnerabilidade WHERE paciente_id = ?', [adulta]);
    expect(
      await codigo(demografia.declararVulnerabilidade(c(), { ...nova, declaradaEm: '2999-01-01' }, t)),
    ).toBe('vulnerabilidade-invalida');
    expect(
      await codigo(demografia.declararVulnerabilidade(c(), { ...nova, declaradaEm: '1970-01-01' }, t)),
    ).toBe('vulnerabilidade-invalida');
    expect(
      await codigo(demografia.declararVulnerabilidade(c(), { ...nova, informanteTipo: 'familiar' }, t)),
    ).toBe('vulnerabilidade-invalida');
    expect(await codigo(demografia.declararVulnerabilidade(c(), { ...nova, condicao: 999_999_999 }, t))).toBe(
      'opcao-invalida',
    );
    expect(await linhas()).toBe(0);
    const id = await demografia.declararVulnerabilidade(c(), nova, t);
    expect(id).toBeGreaterThan(0);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'paciente_vulnerabilidade' AND entidade_id = ?",
        [id],
      ),
    ).toBe(1);
    expect(
      await codigo(demografia.declararVulnerabilidade(c(), { ...nova, declaradaEm: '2026-10-15' }, t)),
    ).toBe('vulnerabilidade-ja-vigente');
    const fim = { paciente: adulta, id, fim: '2026-09-30' };
    expect(await codigo(demografia.encerrarVulnerabilidade(c(), fim, t))).toBe('fim-invalido');
    expect(await codigo(demografia.encerrarVulnerabilidade(c(), { ...fim, paciente: menor }, t))).toBe(
      'vulnerabilidade-inexistente',
    );
    await demografia.encerrarVulnerabilidade(c(), { ...fim, fim: '2026-10-20' }, t);
    expect(await codigo(demografia.encerrarVulnerabilidade(c(), { ...fim, fim: '2026-10-21' }, t))).toBe(
      'vulnerabilidade-inexistente',
    );
    // A encerrada fica no histórico; a mesma condição volta a ser declarada em outra data.
    const novo = await demografia.declararVulnerabilidade(
      c(),
      { ...nova, declaradaEm: '2026-11-01', informanteTipo: 'familiar', informanteNome: `IRMA ${NOME}` },
      t,
    );
    expect(await linhas()).toBe(2);
    const lista = (await demografia.demografia(c(), adulta)).vulnerabilidades;
    expect(lista.map((v) => [v.id, v.vigente, v.declaradaEm, v.fim])).toEqual([
      [novo, true, '2026-11-01', null],
      [id, false, '2026-10-01', '2026-10-20'],
    ]);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM paciente_vulnerabilidade WHERE paciente_id = ? AND excluido_em IS NOT NULL',
        [adulta],
      ),
    ).toBe(0);
  });

  it('doença crônica: declarada com data e informante, uma vigente por doença, encerrada sem apagar', async () => {
    const d = await demografia.demografia(c(), adulta);
    const hipertensao = d.opcoes.condicoesCronicas.find((o) => o.descricao.endsWith('(I10)'))!.id;
    const nova = {
      paciente: adulta,
      condicao: hipertensao,
      declaradaEm: '2026-10-01',
      informanteTipo: 'paciente',
      informanteNome: null,
      observacao: null,
    };
    const t = trilha('paciente_condicao_cronica');
    const linhas = () =>
      contar('SELECT COUNT(*) AS n FROM paciente_condicao_cronica WHERE paciente_id = ?', [adulta]);
    expect(
      await codigo(demografia.declararCondicaoCronica(c(), { ...nova, declaradaEm: '2999-01-01' }, t)),
    ).toBe('condicao-cronica-invalida');
    expect(
      await codigo(demografia.declararCondicaoCronica(c(), { ...nova, informanteTipo: 'responsavel' }, t)),
    ).toBe('condicao-cronica-invalida');
    expect(await codigo(demografia.declararCondicaoCronica(c(), { ...nova, condicao: 999_999_999 }, t))).toBe(
      'opcao-invalida',
    );
    expect(await linhas()).toBe(0);
    const id = await demografia.declararCondicaoCronica(c(), nova, t);
    expect(id).toBeGreaterThan(0);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'paciente_condicao_cronica' AND entidade_id = ?",
        [id],
      ),
    ).toBe(1);
    expect(
      await codigo(demografia.declararCondicaoCronica(c(), { ...nova, declaradaEm: '2026-10-15' }, t)),
    ).toBe('condicao-cronica-ja-vigente');
    const fim = { paciente: adulta, id, fim: '2026-09-30' };
    expect(await codigo(demografia.encerrarCondicaoCronica(c(), fim, t))).toBe('fim-invalido');
    expect(await codigo(demografia.encerrarCondicaoCronica(c(), { ...fim, paciente: menor }, t))).toBe(
      'condicao-cronica-inexistente',
    );
    await demografia.encerrarCondicaoCronica(c(), { ...fim, fim: '2026-10-20' }, t);
    const novo = await demografia.declararCondicaoCronica(
      c(),
      { ...nova, declaradaEm: '2026-11-01', informanteTipo: 'familiar', informanteNome: `IRMA ${NOME}` },
      t,
    );
    expect(await linhas()).toBe(2);
    const lista = (await demografia.demografia(c(), adulta)).condicoesCronicas;
    expect(lista.map((v) => [v.id, v.vigente, v.declaradaEm, v.fim, v.informanteNome])).toEqual([
      [novo, true, '2026-11-01', null, `IRMA ${NOME}`],
      [id, false, '2026-10-01', '2026-10-20', null],
    ]);
    // A doença crônica não entra na lista de vulnerabilidades (listas separadas).
    expect((await demografia.demografia(c(), adulta)).vulnerabilidades.some((v) => v.id === id)).toBe(false);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM paciente_condicao_cronica WHERE paciente_id = ? AND excluido_em IS NOT NULL',
        [adulta],
      ),
    ).toBe(0);
  });
});
