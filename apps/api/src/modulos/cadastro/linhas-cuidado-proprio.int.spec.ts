// Contrato de efeito dos programas de saúde e linhas de cuidado do paciente (F8, 02-CAD linha 11) contra o MariaDB real,
// no cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que
// fica no banco: o programa no catálogo (código repetido recusado); a inscrição no estado de entrada da base, com o
// profissional de referência e a linha do histórico na mesma transação, e a trilha; a segunda inscrição viva recusada
// pelo domínio e pelo índice único da migração 03_CAD/95; a referência exigida pelo programa; suspender sem motivo
// recusado; suspender e voltar a acompanhar; a alta fecha a vigência com o motivo e a inscrição encerrada não muda mais
// (a linha fica, com todo o histórico); a volta ao programa é inscrição nova; o painel conta por estado; a inscrição de
// outro estabelecimento não muda pela sessão deste. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LinhasCuidadoPropria } from './linhas-cuidado-proprio.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f8-02-linhas-cuidado';
const COD = `${MARCA}LC`;

describe.skipIf(SEM_BANCO)('programas de saúde e linhas de cuidado no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: LinhasCuidadoPropria;
  let m: Massa | null = null;
  let paciente = 0;
  let programa = 0;
  let programaRef = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const t = (): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade: 'paciente_linha_cuidado',
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.linha-cuidado' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const c2 = () => ({ ...contextoPorta(m!, COR), estabelecimento: m!.outroEstabelecimento });
  const hoje = () => new Date().toISOString().slice(0, 10);
  const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  const estado = async (codigo: string) =>
    Number((await um<{ id: unknown }>('SELECT id FROM estado_linha_cuidado WHERE codigo = ?', [codigo]))!.id);
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return (e as { problema?: { codigo?: string } }).problema?.codigo ?? String(e);
    }
  };
  const linha = (id: number) =>
    um<Record<string, unknown>>(
      `SELECT pl.ativo, pl.versao, DATE_FORMAT(pl.vigencia_fim, '%Y-%m-%d') AS fim, pl.motivo_saida, pl.inscricao_viva,
              pl.referencia_profissional_id, e.codigo AS estado
         FROM paciente_linha_cuidado pl JOIN estado_linha_cuidado e ON e.id = pl.estado_linha_cuidado_id WHERE pl.id = ?`,
      [id],
    );
  const historico = async (id: number) =>
    Number(
      (await um<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM paciente_linha_cuidado_historico WHERE paciente_linha_cuidado_id = ?',
        [id],
      ))!.n,
    );

  async function limparMinhas(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar(
        `DELETE h FROM paciente_linha_cuidado_historico h
           JOIN paciente_linha_cuidado pl ON pl.id = h.paciente_linha_cuidado_id
           JOIN linha_cuidado l ON l.id = pl.linha_cuidado_id WHERE l.codigo LIKE ?`,
        [`${COD}%`],
      );
      await e.executar(
        'DELETE pl FROM paciente_linha_cuidado pl JOIN linha_cuidado l ON l.id = pl.linha_cuidado_id WHERE l.codigo LIKE ?',
        [`${COD}%`],
      );
      await e.executar('DELETE FROM linha_cuidado WHERE codigo LIKE ?', [`${COD}%`]);
      await e.executar('DELETE FROM faixa_etaria WHERE codigo LIKE ?', [`${COD}%`]);
      await e.executar('DELETE FROM unidade_idade WHERE codigo LIKE ?', [`${COD}%`]);
      await e.executar('DELETE FROM paciente_acesso_restrito WHERE motivo LIKE ?', [`${MARCA}%`]);
    });
  }

  const programaBase = (codigo: string, exigeReferencia: boolean) => ({
    codigo,
    descricao: `${MARCA} PROGRAMA ${codigo}`,
    codigoExterno: null,
    publicoAlvo: 'Adultos hipertensos (sintético)',
    criterioEntrada: 'Pressão alta confirmada',
    criterioSaida: 'Controle sustentado',
    faixaEtaria: null,
    exigeReferencia,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    s = new LinhasCuidadoPropria(nucleo, CLIENTE_F22);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const existente = await um<{ id: unknown }>(
      'SELECT p.id FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.cpf = ? AND p.excluido_em IS NULL',
      [cpfSintetico('990802111')],
    );
    paciente = existente
      ? Number(existente.id)
      : (
          await cadastro.cadastrar(
            contextoPorta(m),
            {
              nome: `PACIENTE LINHA ${MARCA}`,
              nascimento: '1958-07-14',
              sexo: 'F',
              cpf: cpfSintetico('990802111'),
              nomeMae: `MAE ${MARCA}`,
              naturalidade: 'BELO HORIZONTE',
              ufNaturalidade: 'MG',
              cep: CEP_TESTE,
              numero: 111,
              celular: '31999990811',
              contatoNome: `CONTATO ${MARCA}`,
              contatoTelefone: '3133330811',
            },
            contextoGravacao(m),
          )
        ).resultado.idPaciente;
  }, 120_000);

  afterAll(async () => {
    if (m) await limparMinhas();
    await nucleo?.encerrar?.();
  });

  it('inclui o programa no catálogo e recusa o código repetido', async () => {
    programa = await s.incluirLinha(c(), programaBase(`${COD}HA`, false), t());
    programaRef = await s.incluirLinha(c(), programaBase(`${COD}GE`, true), t());
    expect(
      await um('SELECT ativo, exige_profissional_referencia FROM linha_cuidado WHERE id = ?', [programaRef]),
    ).toMatchObject({ ativo: 1, exige_profissional_referencia: 1 });
    expect(await codigo(s.incluirLinha(c(), programaBase(`${COD}HA`, false), t()))).toBe('codigo-repetido');
    const o = await s.opcoes(c());
    expect(o.estados.map((x) => x.codigo)).toEqual(
      expect.arrayContaining(['incluido', 'ativo', 'suspenso', 'alta', 'abandono', 'transferido', 'obito']),
    );
  });

  it('inscreve no estado de entrada com referência, histórico e trilha; a segunda viva é recusada', async () => {
    const id = await s.inscrever(
      c(),
      { paciente, linha: programa, referencia: m!.profissional, vigenciaInicio: diasAtras(10) },
      t(),
    );
    expect(await linha(id)).toMatchObject({
      ativo: 1,
      estado: 'incluido',
      inscricao_viva: 1,
      fim: null,
      referencia_profissional_id: m!.profissional,
    });
    expect(await historico(id)).toBe(1);
    const h = await um<{ operacao: unknown; dados: unknown }>(
      'SELECT operacao, dados FROM paciente_linha_cuidado_historico WHERE paciente_linha_cuidado_id = ?',
      [id],
    );
    expect(h!.operacao).toBe('inclusao');
    expect(typeof h!.dados === 'string' ? JSON.parse(h!.dados) : h!.dados).toMatchObject({
      id,
      paciente,
      linha: programa,
    });
    const tr = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'paciente_linha_cuidado' AND entidade_id = ?",
      [id],
    );
    expect(Number(tr!.n)).toBeGreaterThanOrEqual(1);
    expect(
      await codigo(
        s.inscrever(c(), { paciente, linha: programa, referencia: null, vigenciaInicio: hoje() }, t()),
      ),
    ).toBe('inscricao-viva');
    // O índice único da migração 03_CAD/95 segura a segunda viva mesmo fora da regra. O início é outro dia (11 dias
    // atrás, a primeira começou 10 dias atrás), para que o índice antigo de (paciente, programa, unidade, início) não
    // responda no lugar dele: a recusa tem de citar o índice da inscrição viva.
    const ativo = await estado('ativo');
    const direto = await nucleo
      .escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        e.executar(
          `INSERT INTO paciente_linha_cuidado (paciente_id, linha_cuidado_id, estabelecimento_id, estado_linha_cuidado_id,
             estado_desde, vigencia_inicio, ativo, criado_em) VALUES (?, ?, ?, ?, NOW(3), ?, TRUE, NOW(3))`,
          [paciente, programa, m!.estabelecimento, ativo, diasAtras(11)],
        ),
      )
      .then(
        () => 'gravou',
        (e: unknown) => {
          const x = e as { code?: string; message?: string; cause?: { message?: string } };
          return `${x.code ?? ''} ${x.message ?? ''} ${x.cause?.message ?? ''}`;
        },
      );
    expect(direto).toMatch(/DUP|Duplicate|1062/);
    expect(direto).toContain('uq_paciente_linha_cuidado_viva');
    // Programa que exige o profissional de referência.
    expect(
      await codigo(
        s.inscrever(c(), { paciente, linha: programaRef, referencia: null, vigenciaInicio: hoje() }, t()),
      ),
    ).toBe('referencia-obrigatoria');
    expect(
      await codigo(
        s.inscrever(c(), { paciente, linha: programa, referencia: null, vigenciaInicio: '2999-01-01' }, t()),
      ),
    ).toBe('inscricao-viva');
  });

  it('suspende com motivo, volta a acompanhar, dá alta com motivo e encerra sem apagar; voltar é inscrição nova', async () => {
    const [ins] = await s.doPaciente(c(), paciente);
    expect(ins).toMatchObject({ linha: { id: programa }, encerrada: false });
    const id = ins!.id;
    const suspenso = await estado('suspenso');
    expect(
      await codigo(
        s.mudarEstado(
          c(),
          { paciente, id, versao: ins!.versao, estado: suspenso, data: diasAtras(5), motivo: null },
          t(),
        ),
      ),
    ).toBe('motivo-obrigatorio');
    await s.mudarEstado(
      c(),
      {
        paciente,
        id,
        versao: ins!.versao,
        estado: suspenso,
        data: diasAtras(5),
        motivo: 'Viagem prolongada',
      },
      t(),
    );
    expect(await linha(id)).toMatchObject({ estado: 'suspenso', ativo: 1, fim: null });
    let v = Number((await linha(id))!['versao']);
    // De outro estabelecimento, a inscrição deste não muda.
    expect(
      await codigo(
        s.mudarEstado(
          c2(),
          { paciente, id, versao: v, estado: await estado('ativo'), data: hoje(), motivo: null },
          t(),
        ),
      ),
    ).toBe('estabelecimento-fora-da-sessao');
    await s.mudarEstado(
      c(),
      { paciente, id, versao: v, estado: await estado('ativo'), data: diasAtras(2), motivo: null },
      t(),
    );
    v = Number((await linha(id))!['versao']);
    // A troca da referência grava o histórico também.
    await s.alterarReferencia(c(), { paciente, id, versao: v, referencia: null }, t());
    v = Number((await linha(id))!['versao']);
    // Trocar pelo mesmo (já sem referência) é recusado pela regra do domínio, sem gravar.
    expect(await codigo(s.alterarReferencia(c(), { paciente, id, versao: v, referencia: null }, t()))).toBe(
      'referencia-igual',
    );
    // A linha do tempo diz que foi troca de referência e de quem para quem; o retrato leva o evento e o anterior.
    const trocaHist = await um<{ dados: unknown }>(
      `SELECT dados FROM paciente_linha_cuidado_historico WHERE paciente_linha_cuidado_id = ? ORDER BY id DESC LIMIT 1`,
      [id],
    );
    const dTroca = typeof trocaHist!.dados === 'string' ? JSON.parse(trocaHist!.dados) : trocaHist!.dados;
    expect(dTroca).toMatchObject({ evento: 'referencia', referencia: null });
    const nomeRef = await um<{ nome: unknown }>(
      'SELECT COALESCE(p.nome_exibicao, f.nome) AS nome FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE p.id = ?',
      [m!.profissional],
    );
    const tl = (await s.doPaciente(c(), paciente)).find((x) => x.id === id)!.historico;
    expect(tl.map((h) => h.evento)).toEqual(['inscricao', 'estado', 'estado', 'referencia']);
    expect(tl[3]).toMatchObject({ referenciaDe: String(nomeRef!.nome), referenciaPara: null });
    // A busca do profissional de referência devolve só id e nome, pelo nome.
    const achados = await s.profissionais(c(), String(nomeRef!.nome).slice(0, 6));
    expect(achados.some((x) => x.id === m!.profissional)).toBe(true);
    expect(Object.keys(achados[0]!).sort()).toEqual(['id', 'nome']);
    const r = await s.mudarEstado(
      c(),
      {
        paciente,
        id,
        versao: v,
        estado: await estado('alta'),
        data: hoje(),
        motivo: 'Metas atingidas no programa',
      },
      t(),
    );
    expect(r.encerrada).toBe(true);
    expect(await linha(id)).toMatchObject({
      estado: 'alta',
      ativo: 0,
      fim: hoje(),
      motivo_saida: 'Metas atingidas no programa',
      inscricao_viva: null,
    });
    expect(await historico(id)).toBe(5);
    v = Number((await linha(id))!['versao']);
    expect(
      await codigo(
        s.mudarEstado(
          c(),
          { paciente, id, versao: v, estado: await estado('ativo'), data: hoje(), motivo: null },
          t(),
        ),
      ),
    ).toBe('inscricao-encerrada');
    // A volta ao programa é inscrição nova; a encerrada continua no banco, com o histórico, e sai do índice da viva
    // (inscricao_viva nula), por isso não bloqueia a nova.
    expect((await linha(id))!['inscricao_viva']).toBeNull();
    const nova = await s.inscrever(
      c(),
      { paciente, linha: programa, referencia: null, vigenciaInicio: hoje() },
      t(),
    );
    expect(nova).not.toBe(id);
    const lista = await s.doPaciente(c(), paciente);
    expect(lista.map((x) => [x.id, x.encerrada])).toEqual([
      [nova, false],
      [id, true],
    ]);
    expect(lista[1]!.historico.map((h) => h.estado)).toHaveLength(5);
    expect(lista[0]!.proximos.length).toBeGreaterThan(0);
    expect(lista[1]!.proximos).toEqual([]);
    // Painel do programa: uma viva (incluída) e uma encerrada (alta).
    const p = (await s.opcoes(c())).linhas.find((x) => x.id === programa)!;
    expect(p).toMatchObject({ inscritosVivos: 1, encerradas: 1, porEstado: { incluido: 1, alta: 1 } });
    expect((await s.inscritos(c(), programa, false)).map((x) => x.inscricao)).toEqual([nova]);
    expect((await s.inscritos(c(), programa, true)).map((x) => x.inscricao).sort()).toEqual(
      [id, nova].sort(),
    );
  });

  it('inativa o programa sem apagar e passa a recusar inscrição nova', async () => {
    const atual = (await s.opcoes(c())).linhas.find((x) => x.id === programaRef)!;
    await s.alterarLinha(
      c(),
      { id: programaRef, versao: atual.versao, ativo: false, entrada: programaBase(`${COD}GE`, true) },
      t(),
    );
    expect(await um('SELECT ativo FROM linha_cuidado WHERE id = ?', [programaRef])).toMatchObject({
      ativo: 0,
    });
    expect(
      await codigo(
        s.inscrever(
          c(),
          { paciente, linha: programaRef, referencia: m!.profissional, vigenciaInicio: hoje() },
          t(),
        ),
      ),
    ).toBe('linha-inativa');
  });
  it('a faixa etária vale na unidade dela (meses) e o inscrito com acesso restrito sai pelo pseudônimo', async () => {
    // Puericultura de 0 a 24 meses: o paciente adulto é recusado; a faixa nunca é descartada por não ser em anos.
    const faixa = await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      const sigla = `Z${Date.now().toString(36).slice(-4)}`.toUpperCase();
      const u = await e.inserir(
        `INSERT INTO unidade_idade (codigo, descricao, ativo, sigla, unidade_calculo, criado_em, versao)
           VALUES (?, 'Meses (teste)', TRUE, ?, 'mes', NOW(3), 1)`,
        [`${COD}UM`, sigla],
      );
      return e.inserir(
        `INSERT INTO faixa_etaria (codigo, descricao, ativo, finalidade, unidade_idade_id, idade_inicial, idade_final,
           criado_em, versao) VALUES (?, 'Puericultura 0 a 24 meses (teste)', TRUE, 'regra', ?, 0, 24, NOW(3), 1)`,
        [`${COD}FM`, u],
      );
    });
    expect(faixa).toBeGreaterThan(0);
    const puericultura = await s.incluirLinha(
      c(),
      { ...programaBase(`${COD}PU`, false), faixaEtaria: faixa },
      t(),
    );
    expect(
      await codigo(
        s.inscrever(c(), { paciente, linha: puericultura, referencia: null, vigenciaInicio: hoje() }, t()),
      ),
    ).toBe('fora-da-faixa-etaria');
    // Marca de acesso restrito viva: a lista nominal do programa não mostra o nome, só o pseudônimo.
    const [viva] = await s.inscritos(c(), programa, false);
    expect(viva).toMatchObject({ restrito: false });
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar(
        `INSERT INTO paciente_acesso_restrito (paciente_id, tipo_marca, motivo, vigencia_inicio, exibicao_nome, pseudonimo,
           solicitante_usuario_id, situacao, criado_em) VALUES (?, 'vip', ?, NOW(3) - INTERVAL 1 DAY, 'pseudonimo', 'PACIENTE RESERVADO', ?, 'ativa', NOW(3))`,
        [paciente, `${MARCA} restrito`, m!.usuario],
      ),
    );
    const [oculto] = await s.inscritos(c(), programa, false);
    expect(oculto).toMatchObject({ inscricao: viva!.inscricao, restrito: true, nome: 'PACIENTE RESERVADO' });
    expect(oculto!.nome).not.toBe(viva!.nome);
  });
});
