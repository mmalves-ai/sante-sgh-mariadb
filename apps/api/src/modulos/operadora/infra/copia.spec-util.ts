// Partida comum dos testes de integração da operadora (F2.2, lote 02-10) contra o MariaDB real, no cliente de teste
// da onda (f22_o2, já criado pela obra). O nome do arquivo ficou da fase anterior; o conteúdo é a massa SINTÉTICA no
// banco próprio: dois estabelecimentos de teste (o segundo prova o escopo), o usuário de teste e os cadastros do
// cliente que as portas usam (domínios da rede, da carência, das faixas etárias, da segmentação, dos motivos), todos
// garantidos pelo código (outros lotes da onda usam o mesmo banco: nada é apagado do que pode ser deles). A massa de
// negócio de cada teste fica nos estabelecimentos de teste e é apagada por `limparMassa`. As chaves da operadora vêm de
// uma fonte de configuração falsa (ligadas só no teste). Nenhum dado real; SGH_NUCLEO_SEM_BANCO=1 pula as integrações.
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { ChaveLiberacao, FonteConfiguracao, PrerequisitoRecurso } from '../../config/public-api.js';
import { ServicoBeneficiariosOperadora } from '../aplicacao/beneficiarios.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';
import type { ContextoOperadora, PortaOperadora } from '../porta.js';
import { PortaOperadoraPropria } from '../porta-propria.js';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
export const PODE = process.env['SGH_NUCLEO_SEM_BANCO'] !== '1';
/** Estabelecimento de teste (código no formato do contrato: minúsculas e dígitos). */
export const COD = 'l0210';
export const COD_OUTRO = 'l0210b';
export const USUARIO = 'l0210.teste';

export function criarNucleo(): NucleoProprio {
  return new NucleoProprio();
}

export interface MassaBase {
  readonly est: number;
  readonly outroEst: number;
  readonly usuario: number;
}

async function garantir(
  e: Escritor,
  sel: string,
  p: readonly unknown[],
  ins: string,
  pi: readonly unknown[],
): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l['id']) : e.inserir(ins, pi);
}

/** Garante uma linha de domínio pelo código (as colunas extras só na inclusão). */
async function dominio(
  e: Escritor,
  tabela: string,
  codigo: string,
  extras: Record<string, unknown>,
): Promise<number> {
  const colunas = ['codigo', ...Object.keys(extras), 'criado_em'];
  return garantir(
    e,
    `SELECT id FROM ${tabela} WHERE codigo = ?`,
    [codigo],
    `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
    [codigo, ...Object.values(extras), new Date()],
  );
}

/** Estabelecimentos, usuário e os cadastros do cliente que as portas da operadora usam. */
export async function prepararBase(nucleo: NucleoProprio): Promise<MassaBase> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-10' }, async (e) => {
    const agora = new Date();
    const est = (codigo: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [codigo],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
      );
    const massa = {
      est: await est(COD),
      outroEst: await est(COD_OUTRO),
      usuario: await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [USUARIO],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [USUARIO, 'USUARIO SINTETICO L0210', agora],
      ),
    };
    // Rede credenciada: códigos do padrão da ANS (o contrato da tela usa os números).
    for (const [c, d] of [
      ['1', 'Consultório médico'],
      ['3', 'Hospital geral'],
      ['4', 'Laboratório'],
    ] as const)
      await dominio(e, 'tipo_prestador_rede', c, { descricao: d });
    for (const [c, d] of [
      ['1', 'Rede contratada'],
      ['2', 'Rede própria'],
    ] as const)
      await dominio(e, 'natureza_prestador_rede', c, { descricao: d });
    for (const [c, d, n] of [
      ['1', 'Ambulatorial', 'ambulatorial'],
      ['2', 'Hospitalar', 'hospitalar'],
    ] as const)
      await dominio(e, 'regime_atendimento_rede', c, { descricao: d, natureza: n });
    for (const c of ['inclusao', 'alteracao', 'exclusao', 'reinclusao'])
      await dominio(e, 'situacao_movimento_rede', c, { descricao: `Movimento ${c}` });
    // Município e UF sintéticos (o catálogo do IBGE pode não estar carregado no banco de teste).
    const pais = await garantir(
      e,
      'SELECT id FROM pais_referencia WHERE codigo_iso = ?',
      ['BR'],
      'INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES (?, ?, ?)',
      ['BR', 'Brasil', agora],
    );
    const uf = await garantir(
      e,
      'SELECT id FROM unidade_federativa WHERE sigla = ?',
      ['SP'],
      'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES (?, ?, ?, ?, ?)',
      ['35', 'SP', 'São Paulo', pais, agora],
    );
    await garantir(
      e,
      'SELECT id FROM municipio_ibge WHERE codigo_ibge = ?',
      ['3550308'],
      'INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES (?, ?, ?, ?)',
      ['3550308', 'São Paulo', uf, agora],
    );
    // Beneficiário e produto.
    for (const [c, d, s] of [
      ['F', 'Feminino', 'F'],
      ['M', 'Masculino', 'M'],
    ] as const) {
      const ja = await e.uma('SELECT id FROM sexo WHERE sigla = ?', [s]);
      if (!ja) await dominio(e, 'sexo', `l0210-${c}`, { descricao: d, sigla: s });
    }
    for (const [c, d] of [
      ['2', 'Responsável legal'],
      ['3', 'Cônjuge'],
      ['5', 'Filho ou filha'],
    ] as const)
      await dominio(e, 'grau_parentesco_dependente', c, { descricao: d, tipo_beneficiario: 'dependente' });
    for (const [c, d] of [
      ['1', 'Apartamento'],
      ['2', 'Enfermaria'],
      ['3', 'Ambulatório'],
    ] as const)
      await dominio(e, 'tipo_acomodacao_plano', c, { descricao: d });
    for (const t of ['individual_familiar', 'coletivo_empresarial', 'coletivo_adesao'])
      if (
        !(await e.uma('SELECT id FROM classificacao_plano WHERE tipo_contratacao = ? AND ativo = TRUE', [t]))
      )
        await dominio(e, 'classificacao_plano', `l0210-${t}`.slice(0, 30), {
          descricao: t,
          tipo_contratacao: t,
        });
    for (const t of ['urgencia_emergencia', 'parto', 'outro', 'doenca_preexistente'])
      if (!(await e.uma('SELECT id FROM grupo_prazo_carencia WHERE tipo_carencia = ? AND ativo = TRUE', [t])))
        await dominio(e, 'grupo_prazo_carencia', `l0210-${t}`.slice(0, 30), {
          descricao: t,
          tipo_carencia: t,
          prazo_dias: 730,
          vigencia_inicio: '2000-01-01',
        });
    if (!(await e.uma("SELECT id FROM faixa_etaria_modelo WHERE tipo = 'dez_faixas' AND ativo = TRUE"))) {
      const modelo = await dominio(e, 'faixa_etaria_modelo', 'l0210-rn63', {
        descricao: 'Dez faixas',
        tipo: 'dez_faixas',
      });
      const faixas = [0, 19, 24, 29, 34, 39, 44, 49, 54, 59];
      for (const [i, de] of faixas.entries())
        await e.inserir(
          'INSERT INTO faixa_etaria_modelo_item (faixa_etaria_modelo_id, sequencia, descricao, idade_inicial, idade_final, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [modelo, i + 1, `Faixa ${i + 1}`, de, i === 9 ? null : (faixas[i + 1] ?? 1) - 1, agora],
        );
    }
    const segs: [string, boolean, boolean, boolean, boolean, boolean][] = [
      ['l0210-amb', true, false, false, false, false],
      ['l0210-ah', true, true, true, false, false],
    ];
    for (const [c, amb, hosp, obst, odonto, ref] of segs)
      if (
        !(await e.uma(
          `SELECT id FROM segmentacao_assistencial WHERE inclui_ambulatorial = ? AND inclui_hospitalar = ? AND inclui_obstetricia = ?
              AND inclui_odontologia = ? AND plano_referencia = ?`,
          [amb, hosp, obst, odonto, ref],
        ))
      )
        await e.inserir(
          `INSERT INTO segmentacao_assistencial (codigo_ans, descricao, inclui_ambulatorial, inclui_hospitalar, inclui_obstetricia,
             inclui_odontologia, plano_referencia, vigencia_inicio, versao_fonte, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c, c, amb, hosp, obst, odonto, ref, '2000-01-01', 'teste', agora],
        );
    await dominio(e, 'motivo_movimento_cadastral', 'l0210-pedido', {
      descricao: 'A pedido (sintético)',
      tipo_movimento: 'exclusao',
    });
    await dominio(e, 'motivo_solicitacao_cartao', 'l0210-perda', { descricao: 'Perda (sintético)' });
    return massa;
  });
}

/** O contexto da porta no estabelecimento de teste (ou no outro, para provar o escopo). */
export function contexto(m: MassaBase, outro = false): ContextoOperadora {
  return {
    cliente: CLIENTE,
    estabelecimento: outro ? m.outroEst : m.est,
    usuario: m.usuario,
    correlacao: 'teste-02-10',
    rede: 'rede-teste',
    hospital: outro ? COD_OUTRO : COD,
  };
}

const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-24T10:00:00',
});
const registro: PrerequisitoRecurso = {
  recurso: 'operadora',
  tipo: 'credenciamento',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-24T10:00:00',
};
/** Fonte de configuração com a operadora e as fatias pedidas ligadas (só no teste). */
export function fonteLigada(
  chaves: readonly string[] = ['operadora', 'operadora.beneficiarios'],
): FonteConfiguracao {
  return {
    chaves: async () => chaves.map(chave),
    prerequisitos: async () => [registro],
  } as unknown as FonteConfiguracao;
}

/** A porta própria e o serviço da F1 sobre o banco do cliente de teste. */
export function servicoNoBanco(nucleo: NucleoProprio): {
  porta: PortaOperadora;
  servico: ServicoBeneficiariosOperadora;
} {
  const porta = new PortaOperadoraPropria(nucleo, CLIENTE);
  return {
    porta,
    servico: new ServicoBeneficiariosOperadora(porta, new ServicoSituacaoOperadora(fonteLigada(), null)),
  };
}

/** Sessão mínima do serviço (o gestor da operadora no estabelecimento de teste). */
export function sessao(
  m: MassaBase,
  permissoes: readonly string[] | 'todas' = 'todas',
  outro = false,
): SessaoCadastro {
  const req = {
    headers: {},
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as unknown as RequisicaoAutorizada;
  const c = contexto(m, outro);
  return {
    req,
    hospital: c.hospital,
    rede: c.rede,
    login: USUARIO,
    porta: c,
    pode: (x) => permissoes === 'todas' || permissoes.includes(x),
  };
}

/** O código da recusa (ErroProblema, ErroOperacao do núcleo) ou 'gravou'. */
export async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (x) {
    if (x instanceof ErroOperacao) return String(x.problema.codigo ?? x.problema.status);
    const e = x as { extras?: { codigo?: string }; problema?: { codigo?: string }; getStatus?: () => number };
    return e.extras?.codigo ?? e.problema?.codigo ?? String(e.getStatus?.() ?? x);
  }
}

const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];

/** Operadora, plano individual, contrato de pessoa física, titular e dependente SINTÉTICOS, pelo serviço da F1. */
export async function montarCarteira(
  servico: ServicoBeneficiariosOperadora,
  s: SessaoCadastro,
  n: { registro: string; base: string; pacienteHospital?: number | null; diaVencimento?: number | null },
) {
  const ope = await servico.gravarOperadora(s, null, {
    registroAns: n.registro,
    cnpj: cnpjSintetico(`${n.base}0001`.padStart(12, '9').slice(-12)),
    razaoSocial: `Operadora Sintética ${n.registro}`,
    nomeFantasia: null,
    modalidade: 'medicinaGrupo',
    situacao: 'ativa',
  });
  const prod = await servico.gravarProduto(s, null, {
    operadora: ope.id,
    codigo: `INT-${n.registro}`,
    nome: 'Plano sintético da integração',
    natureza: 'plano',
    registroAns: `9${n.registro}01`.slice(0, 9).padEnd(9, '0'),
    tipoContratacao: 1,
    segmentacao: 'ambulatorialHospitalar',
    abrangencia: 'estadual',
    acomodacao: 2,
    coparticipacao: { tipo: 2, valor: 30 },
    carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    precos: PRECOS,
    situacao: 'ativo',
  });
  const ctr = await servico.gravarContrato(s, null, {
    produto: prod.id,
    numero: `INT-${n.registro}-1`,
    tipo: 1,
    contratanteNome: 'Contratante Sintético da Integração',
    contratanteDocumento: cpfSintetico(`${n.base}1`.slice(-9).padStart(9, '9')),
    formaReajuste: 1,
    mesReajuste: 5,
    tipoVigencia: 2,
    inicio: '2026-01-01',
    fim: null,
    diaVencimento: n.diaVencimento ?? null,
    situacao: 'ativo',
    motivoSituacao: null,
  });
  const tit = await servico.gravarBeneficiario(s, null, {
    contrato: ctr.id,
    titular: null,
    vinculo: 1,
    nome: 'Titular Sintética da Integração',
    nomeSocial: null,
    cpf: cpfSintetico(`${n.base}2`.slice(-9).padStart(9, '9')),
    nascimento: '1980-05-10',
    sexo: 'F',
    cns: null,
    nomeMae: 'Mãe Sintética',
    inclusao: '2026-02-01',
    pacienteHospital: n.pacienteHospital ?? null,
  });
  const dep = await servico.gravarBeneficiario(s, null, {
    contrato: ctr.id,
    titular: tit.id,
    vinculo: 5,
    nome: 'Dependente Sintético da Integração',
    nomeSocial: null,
    cpf: null,
    nascimento: '2015-03-01',
    sexo: 'M',
    cns: null,
    nomeMae: 'Titular Sintética da Integração',
    inclusao: '2026-02-01',
    pacienteHospital: null,
  });
  return { operadora: ope.id, produto: prod.id, contrato: ctr.id, titular: tit, dependente: dep.id };
}

/**
 * Apaga a massa de negócio dos estabelecimentos de teste (rede, beneficiários, contratos, produtos e operadoras de
 * teste). Os domínios, os estabelecimentos e o usuário ficam (a trilha, só de inclusão, os referencia).
 */
export async function limparMassa(nucleo: NucleoProprio, m: MassaBase): Promise<void> {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-10' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const em = '(?, ?)';
    // Rede credenciada (C2-118: as linhas filhas do prestador antes dele).
    for (const t of [
      'suspensao_prestador_rede',
      'descredenciamento_prestador',
      'especialidade_atendida_rede',
      'qualificacao_prestador_rede',
      'local_atendimento_rede',
    ])
      await e.executar(
        `DELETE x FROM ${t} x JOIN prestador_rede p ON p.id = x.prestador_rede_id WHERE p.estabelecimento_id IN ${em}`,
        ests,
      );
    await e.executar(
      `DELETE m FROM movimento_rede_ans m JOIN prestador_rede p ON p.id = m.prestador_rede_id WHERE p.estabelecimento_id IN ${em}`,
      ests,
    );
    await e.executar(
      `DELETE h FROM prestador_rede_historico h JOIN prestador_rede p ON p.id = h.prestador_rede_id WHERE p.estabelecimento_id IN ${em}`,
      ests,
    );
    await e.executar(`DELETE FROM contrato_rede_prestador WHERE estabelecimento_id IN ${em}`, ests);
    await e.executar(`DELETE FROM prestador_rede WHERE estabelecimento_id IN ${em}`, ests);
    // Beneficiários e contratos.
    const benef = `SELECT b.id FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id WHERE cp.estabelecimento_id IN ${em}`;
    await e.executar(
      `DELETE FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id IN (${benef})`,
      ests,
    );
    await e.executar(`DELETE FROM cartao_beneficiario WHERE beneficiario_plano_id IN (${benef})`, ests);
    await e.executar(
      `UPDATE beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id SET b.titular_beneficiario_plano_id = NULL,
          b.tipo = 'titular', b.grau_parentesco_dependente_id = NULL WHERE cp.estabelecimento_id IN ${em}`,
      ests,
    );
    await e.executar(
      `DELETE b FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id WHERE cp.estabelecimento_id IN ${em}`,
      ests,
    );
    const ctrs = await e.consultar<{ contratante_plano_id: unknown }>(
      `SELECT DISTINCT contratante_plano_id FROM contrato_plano WHERE estabelecimento_id IN ${em}`,
      ests,
      { teto: 10_000 },
    );
    await e.executar(`DELETE FROM contrato_plano WHERE estabelecimento_id IN ${em}`, ests);
    for (const c of ctrs)
      await e.executar(
        'DELETE FROM contratante_plano WHERE id = ? AND NOT EXISTS (SELECT 1 FROM contrato_plano WHERE contratante_plano_id = ?)',
        [c['contratante_plano_id'], c['contratante_plano_id']],
      );
    // Produtos (com os satélites) e operadoras de teste.
    const prods = `SELECT id FROM produto_plano WHERE estabelecimento_id IN ${em}`;
    const planos = `SELECT id FROM plano_comercializado WHERE estabelecimento_id IN ${em}`;
    await e.executar(`DELETE FROM tabela_preco_plano_faixa WHERE produto_plano_id IN (${prods})`, ests);
    await e.executar(`DELETE FROM carencia_produto_contrato WHERE produto_plano_id IN (${prods})`, ests);
    await e.executar(`DELETE FROM produto_plano_segmentacao WHERE produto_plano_id IN (${prods})`, ests);
    await e.executar(`DELETE FROM regra_coparticipacao WHERE plano_comercializado_id IN (${planos})`, ests);
    await e.executar(`DELETE FROM plano_comercializado WHERE estabelecimento_id IN ${em}`, ests);
    await e.executar(`DELETE FROM produto_plano WHERE estabelecimento_id IN ${em}`, ests);
    const opes = await e.consultar<{ id: unknown; pj: unknown }>(
      `SELECT o.id, o.pessoa_juridica_id AS pj FROM operadora_saude o
        WHERE EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe WHERE oe.operadora_saude_id = o.id AND oe.estabelecimento_id IN ${em})`,
      ests,
      { teto: 1_000 },
    );
    for (const o of opes) {
      await e.executar(
        'DELETE f FROM tabela_preco_plano_faixa f JOIN tabela_preco_plano t ON t.id = f.tabela_preco_plano_id WHERE t.operadora_saude_id = ?',
        [o['id']],
      );
      await e.executar('DELETE FROM tabela_preco_plano WHERE operadora_saude_id = ?', [o['id']]);
      await e.executar('DELETE FROM operadora_saude_historico WHERE operadora_saude_id = ?', [o['id']]);
      await e.executar('DELETE FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ?', [o['id']]);
      await e.executar('DELETE FROM operadora_saude WHERE id = ?', [o['id']]);
      await e.executar(
        'DELETE FROM pessoa_juridica WHERE id = ? AND NOT EXISTS (SELECT 1 FROM operadora_saude WHERE pessoa_juridica_id = ?)',
        [o['pj'], o['pj']],
      );
    }
  });
}
