// Sinais vitais com o detalhe da aferição e os limites de alerta por setor, no banco PRÓPRIO (F3.3, 03-PEP L115):
//   - catálogos da aferição (parâmetros, instrumentos, locais, posições, motivos de não aferir e setores);
//   - limites de alerta (limite_parametro_vital): incluir, inativar com motivo (nunca apagar) e aplicar o padrão do
//     adulto pelo NEWS2 ao estabelecimento;
//   - regra do parâmetro no setor (parametro_vital_setor): exibir e exigir local e posição, obrigatório, periodicidade;
//   - a aferição detalhada: uma linha em afericao e, por parâmetro, uma em afericao_valor com instrumento, local,
//     posição, "não aferido" com o motivo, e o nivel_alerta do limite que vale para o paciente (setor, instrumento,
//     sexo, idade). As regras são do domínio (conferirDetalheAfericao, nivelDaAfericao, conferirLimite); aqui só a
//     leitura, a trava e a gravação, dentro da operação do Executor (trilha e idempotência na mesma transação).
import { SINAIS_VITAIS, type TipoSinalVital } from '@sgh/contratos';
import {
  conferirDetalheAfericao,
  conferirLimite,
  type ErroAfericao,
  idadeEmDias,
  LIMITES_PADRAO_NEWS2,
  type LimiteEntrada,
  type LimiteParametro,
  nivelDaAfericao,
  validarSinal,
} from '@sgh/dominio-enfermagem';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  booleano,
  civilDe,
  dataDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  type Linha,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import { type AnotacaoGravacao, conferirAtendimento } from './gravacao-direta.js';

export const TABELAS_AFERICAO_DETALHE = ['afericao', 'afericao_valor'] as const;
export const TABELAS_LIMITES = ['limite_parametro_vital', 'parametro_vital_setor'] as const;

const decimal = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function primeiroErro(erros: readonly ErroAfericao[], prefixo = ''): void {
  const e = erros[0];
  if (e) throw recusa(e.codigo, `${prefixo}${e.mensagem}`);
}

// ---------------------------------------------------------------- catálogos

export interface CatalogosAfericao {
  readonly parametros: readonly {
    codigo: string;
    descricao: string;
    unidade: string | null;
    alertaMinimo: number | null;
    alertaMaximo: number | null;
    exibeLocal: boolean;
    exigeLocal: boolean;
    exibePosicao: boolean;
    exigePosicao: boolean;
  }[];
  readonly instrumentos: readonly {
    id: number;
    descricao: string;
    parametro: string | null;
    padrao: boolean;
  }[];
  readonly locais: readonly { id: number; descricao: string }[];
  readonly posicoes: readonly { id: number; descricao: string }[];
  readonly motivos: readonly { id: number; descricao: string; exigeComplemento: boolean }[];
  readonly setores: readonly { id: number; nome: string }[];
}

export async function catalogosAfericao(l: Leitor, est: number): Promise<CatalogosAfericao> {
  const [pv, ins, loc, pos, mot, set] = await Promise.all([
    l.consultar(
      `SELECT codigo, descricao, unidade, alerta_minimo, alerta_maximo, exibe_local_afericao, exige_local_afericao,
              exibe_posicao_paciente, exige_posicao_paciente
         FROM parametro_vital WHERE ativo ORDER BY ordem, descricao`,
    ),
    l.consultar(
      `SELECT i.id, i.descricao, i.padrao, p.codigo AS parametro FROM instrumento_afericao i
         LEFT JOIN parametro_vital p ON p.id = i.parametro_vital_id WHERE i.ativo ORDER BY i.descricao`,
    ),
    l.consultar('SELECT id, descricao FROM local_afericao WHERE ativo ORDER BY descricao'),
    l.consultar('SELECT id, descricao FROM posicao_afericao WHERE ativo ORDER BY ordem, descricao'),
    l.consultar(
      'SELECT id, descricao, exige_complemento FROM motivo_nao_afericao WHERE ativo ORDER BY descricao',
    ),
    l.consultar(
      'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome',
      [est],
    ),
  ]);
  return {
    parametros: pv.map((r) => ({
      codigo: texto(r['codigo']),
      descricao: texto(r['descricao']),
      unidade: textoOuNulo(r['unidade']),
      alertaMinimo: decimal(r['alerta_minimo']),
      alertaMaximo: decimal(r['alerta_maximo']),
      exibeLocal: booleano(r['exibe_local_afericao']),
      exigeLocal: booleano(r['exige_local_afericao']),
      exibePosicao: booleano(r['exibe_posicao_paciente']),
      exigePosicao: booleano(r['exige_posicao_paciente']),
    })),
    instrumentos: ins.map((r) => ({
      id: num(r['id']),
      descricao: texto(r['descricao']),
      parametro: textoOuNulo(r['parametro']),
      padrao: booleano(r['padrao']),
    })),
    locais: loc.map((r) => ({ id: num(r['id']), descricao: texto(r['descricao']) })),
    posicoes: pos.map((r) => ({ id: num(r['id']), descricao: texto(r['descricao']) })),
    motivos: mot.map((r) => ({
      id: num(r['id']),
      descricao: texto(r['descricao']),
      exigeComplemento: booleano(r['exige_complemento']),
    })),
    setores: set.map((r) => ({ id: num(r['id']), nome: texto(r['nome']) })),
  };
}

// ---------------------------------------------------------------- limites

export interface LimiteCadastrado extends LimiteEntrada {
  readonly id: number;
  readonly parametro: string;
  readonly parametroDescricao: string;
  readonly estabelecimento: number | null;
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly instrumento: number | null;
  readonly instrumentoDescricao: string | null;
  readonly ativo: boolean;
  readonly versao: number;
}

function limiteDe(r: Linha): LimiteParametro {
  return {
    id: num(r['id']),
    estabelecimento: numOuNulo(r['estabelecimento_id']),
    setor: numOuNulo(r['setor_funcional_id']),
    instrumento: numOuNulo(r['instrumento_afericao_id']),
    sexo: texto(r['sexo']) as LimiteParametro['sexo'],
    idadeMinimaDias: num(r['idade_minima_dias']),
    idadeMaximaDias: numOuNulo(r['idade_maxima_dias']),
    limiteInferior: decimal(r['limite_inferior']),
    normalInferior: decimal(r['normal_inferior']),
    normalSuperior: decimal(r['normal_superior']),
    limiteSuperior: decimal(r['limite_superior']),
    ativo: booleano(r['ativo']),
  };
}

const COLUNAS_LIMITE = `l.id, l.estabelecimento_id, l.setor_funcional_id, l.instrumento_afericao_id, l.sexo,
  l.idade_minima_dias, l.idade_maxima_dias, l.limite_inferior, l.normal_inferior, l.normal_superior,
  l.limite_superior, l.ativo, l.versao`;

/** Os limites que valem no estabelecimento (os do cliente inteiro e os dele), ativos e inativos (histórico). */
export async function limitesDoEstabelecimento(l: Leitor, est: number): Promise<LimiteCadastrado[]> {
  const rs = await l.consultar(
    `SELECT ${COLUNAS_LIMITE}, p.codigo AS parametro, p.descricao AS parametro_descricao, s.nome AS setor_nome,
            i.descricao AS instrumento_descricao
       FROM limite_parametro_vital l
       JOIN parametro_vital p ON p.id = l.parametro_vital_id
       LEFT JOIN setor_funcional s ON s.id = l.setor_funcional_id
       LEFT JOIN instrumento_afericao i ON i.id = l.instrumento_afericao_id
      WHERE l.estabelecimento_id IS NULL OR l.estabelecimento_id = ?
      ORDER BY l.ativo DESC, p.ordem, p.descricao, l.setor_funcional_id, l.idade_minima_dias, l.id`,
    [est],
  );
  return rs.map((r) => ({
    ...limiteDe(r),
    parametro: texto(r['parametro']),
    parametroDescricao: texto(r['parametro_descricao']),
    setorNome: textoOuNulo(r['setor_nome']),
    instrumentoDescricao: textoOuNulo(r['instrumento_descricao']),
    versao: num(r['versao']),
  }));
}

export interface PedidoLimite extends LimiteEntrada {
  readonly parametro: string;
  /** Vale para o cliente inteiro (todos os estabelecimentos) ou só para este. */
  readonly abrangencia: 'cliente' | 'estabelecimento';
  readonly setor: number | null;
  readonly instrumento: number | null;
}

async function parametroPorCodigo(l: Leitor, codigo: string): Promise<number> {
  const p = await l.uma<{ id: number }>('SELECT id FROM parametro_vital WHERE codigo = ? AND ativo', [
    codigo,
  ]);
  if (!p) throw recusa('parametro-inexistente', `O parâmetro vital "${codigo}" não está no cadastro.`);
  return Number(p.id);
}

async function conferirSetor(l: Leitor, est: number, setor: number): Promise<void> {
  const s = await l.uma(
    'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [setor, est],
  );
  if (!s) throw recusa('setor-inexistente', 'O setor não é deste estabelecimento.');
}

export async function incluirLimiteTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  e: PedidoLimite,
): Promise<{ id: number }> {
  primeiroErro(conferirLimite(e));
  const parametro = await parametroPorCodigo(tx, e.parametro);
  if (e.setor !== null) await conferirSetor(tx, est, e.setor);
  if (e.instrumento !== null) {
    const i = await tx.uma<{ parametro_vital_id: unknown }>(
      'SELECT parametro_vital_id FROM instrumento_afericao WHERE id = ? AND ativo',
      [e.instrumento],
    );
    if (!i) throw recusa('instrumento-inexistente', 'O instrumento não está no cadastro.');
    if (i.parametro_vital_id !== null && Number(i.parametro_vital_id) !== parametro)
      throw recusa('instrumento-de-outro-parametro', 'O instrumento mede outro parâmetro.');
  }
  // O limite do setor é sempre do estabelecimento do setor.
  const estabelecimento = e.abrangencia === 'cliente' && e.setor === null ? null : est;
  const id = await tx.incluir('limite_parametro_vital', {
    parametro_vital_id: parametro,
    estabelecimento_id: estabelecimento,
    setor_funcional_id: e.setor,
    instrumento_afericao_id: e.instrumento,
    sexo: e.sexo,
    idade_minima_dias: e.idadeMinimaDias,
    idade_maxima_dias: e.idadeMaximaDias,
    limite_inferior: e.limiteInferior,
    normal_inferior: e.normalInferior,
    normal_superior: e.normalSuperior,
    limite_superior: e.limiteSuperior,
    ativo: true,
  });
  an.dados = { parametro: e.parametro, estabelecimento, setor: e.setor, instrumento: e.instrumento };
  return { id };
}

export async function inativarLimiteTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  versao: number,
  motivo: string,
): Promise<{ id: number; versao: number }> {
  const [r] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, ativo FROM limite_parametro_vital
      WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [id, est],
  );
  if (!r) throw recusa('limite-inexistente', 'O limite não foi encontrado.');
  if (!booleano(r['ativo'])) throw recusa('limite-ja-inativo', 'Este limite já está inativo.');
  const nova = await tx.alterar('limite_parametro_vital', id, versao, { ativo: false });
  an.motivo = motivo;
  return { id, versao: nova };
}

/** Inclui no estabelecimento os limites do adulto pelo NEWS2 que ainda não tem (geral: sem setor e sem instrumento). */
export async function aplicarPadraoNews2Tx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
): Promise<{ incluidos: string[]; jaTinha: string[]; semParametro: string[] }> {
  const incluidos: string[] = [];
  const jaTinha: string[] = [];
  const semParametro: string[] = [];
  for (const [codigo, p] of Object.entries(LIMITES_PADRAO_NEWS2)) {
    const pv = await tx.uma<{ id: number }>('SELECT id FROM parametro_vital WHERE codigo = ? AND ativo', [
      codigo,
    ]);
    if (!pv) {
      semParametro.push(codigo);
      continue;
    }
    const existe = await tx.uma(
      `SELECT id FROM limite_parametro_vital
        WHERE parametro_vital_id = ? AND estabelecimento_id = ? AND setor_funcional_id IS NULL
          AND instrumento_afericao_id IS NULL AND sexo = 'ambos' AND ativo`,
      [Number(pv.id), est],
    );
    if (existe) {
      jaTinha.push(codigo);
      continue;
    }
    await tx.incluir('limite_parametro_vital', {
      parametro_vital_id: Number(pv.id),
      estabelecimento_id: est,
      sexo: 'ambos',
      idade_minima_dias: p.idadeMinimaDias,
      limite_inferior: p.limiteInferior,
      normal_inferior: p.normalInferior,
      normal_superior: p.normalSuperior,
      limite_superior: p.limiteSuperior,
      ativo: true,
    });
    incluidos.push(codigo);
  }
  an.dados = { padrao: 'news2-adulto', incluidos, jaTinha };
  return { incluidos, jaTinha, semParametro };
}

// ---------------------------------------------------------------- regra do parâmetro no setor

export interface RegraSetor {
  readonly id: number;
  readonly setor: number;
  readonly setorNome: string;
  readonly parametro: string;
  readonly parametroDescricao: string;
  readonly obrigatorio: boolean;
  readonly periodicidadeMinutos: number | null;
  readonly exibeLocal: boolean;
  readonly exigeLocal: boolean;
  readonly exibePosicao: boolean;
  readonly exigePosicao: boolean;
  readonly ativo: boolean;
  readonly versao: number;
}

export async function regrasDosSetores(l: Leitor, est: number): Promise<RegraSetor[]> {
  const rs = await l.consultar(
    `SELECT r.id, r.setor_funcional_id, s.nome AS setor_nome, p.codigo, p.descricao, r.obrigatorio,
            r.periodicidade_minutos, r.exibe_local_afericao, r.exige_local_afericao, r.exibe_posicao_afericao,
            r.exige_posicao_afericao, r.ativo, r.versao
       FROM parametro_vital_setor r
       JOIN setor_funcional s ON s.id = r.setor_funcional_id
       JOIN parametro_vital p ON p.id = r.parametro_vital_id
      WHERE s.estabelecimento_id = ?
      ORDER BY s.nome, r.ordem, p.ordem, p.descricao`,
    [est],
  );
  return rs.map((r) => ({
    id: num(r['id']),
    setor: num(r['setor_funcional_id']),
    setorNome: texto(r['setor_nome']),
    parametro: texto(r['codigo']),
    parametroDescricao: texto(r['descricao']),
    obrigatorio: booleano(r['obrigatorio']),
    periodicidadeMinutos: numOuNulo(r['periodicidade_minutos']),
    exibeLocal: booleano(r['exibe_local_afericao']),
    exigeLocal: booleano(r['exige_local_afericao']),
    exibePosicao: booleano(r['exibe_posicao_afericao']),
    exigePosicao: booleano(r['exige_posicao_afericao']),
    ativo: booleano(r['ativo']),
    versao: num(r['versao']),
  }));
}

export interface PedidoRegraSetor {
  readonly setor: number;
  readonly parametro: string;
  readonly obrigatorio: boolean;
  readonly periodicidadeMinutos: number | null;
  readonly exibeLocal: boolean;
  readonly exigeLocal: boolean;
  readonly exibePosicao: boolean;
  readonly exigePosicao: boolean;
  readonly ativo: boolean;
  /** Versão lida na tela, quando a regra já existe (trava otimista). */
  readonly versao: number | null;
}

/** Grava a regra do parâmetro no setor (inclui ou altera a do par setor e parâmetro); exigir implica exibir. */
export async function gravarRegraSetorTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  e: PedidoRegraSetor,
): Promise<{ id: number; versao: number }> {
  await conferirSetor(tx, est, e.setor);
  const parametro = await parametroPorCodigo(tx, e.parametro);
  const valores = {
    obrigatorio: e.obrigatorio,
    periodicidade_minutos: e.periodicidadeMinutos,
    exibe_local_afericao: e.exibeLocal || e.exigeLocal,
    exige_local_afericao: e.exigeLocal,
    exibe_posicao_afericao: e.exibePosicao || e.exigePosicao,
    exige_posicao_afericao: e.exigePosicao,
    ativo: e.ativo,
  };
  const [r] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao FROM parametro_vital_setor WHERE setor_funcional_id = ? AND parametro_vital_id = ?',
    [e.setor, parametro],
  );
  an.dados = {
    setor: e.setor,
    parametro: e.parametro,
    exigeLocal: e.exigeLocal,
    exigePosicao: e.exigePosicao,
  };
  if (!r) {
    const id = await tx.incluir('parametro_vital_setor', {
      setor_funcional_id: e.setor,
      parametro_vital_id: parametro,
      ...valores,
    });
    return { id, versao: 1 };
  }
  const versao = await tx.alterar(
    'parametro_vital_setor',
    num(r['id']),
    e.versao ?? num(r['versao']),
    valores,
  );
  return { id: num(r['id']), versao };
}

// ---------------------------------------------------------------- aferição detalhada

export interface ValorAfericaoPedido {
  readonly tipo: string;
  readonly valor: number | null;
  readonly instrumento: number | null;
  readonly local: number | null;
  readonly posicao: number | null;
  readonly naoAferido: boolean;
  readonly motivo: number | null;
  readonly justificativa: string | null;
  readonly confirmadoForaDaFaixa: boolean;
}

export interface PedidoAfericao {
  readonly paciente: number;
  readonly atendimento: number | null;
  /** Hora civil da aferição no fuso do estabelecimento (AAAA-MM-DDTHH:MM). */
  readonly horaReal: string;
  readonly observacao: string | null;
  readonly valores: readonly ValorAfericaoPedido[];
}

export interface AfericaoFeita {
  readonly afericao: number;
  readonly setor: number | null;
  readonly valores: readonly {
    id: number;
    tipo: string;
    nivel: 'normal' | 'atencao' | 'critico' | null;
    limite: number | null;
  }[];
}

export async function registrarAfericaoTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  e: PedidoAfericao,
): Promise<AfericaoFeita> {
  if (e.valores.length === 0) throw recusa('afericao-vazia', 'Informe ao menos um parâmetro.');
  const tipos = new Set<string>();
  for (const v of e.valores) {
    if (tipos.has(v.tipo)) throw recusa('parametro-repetido', `O parâmetro "${v.tipo}" veio duas vezes.`);
    tipos.add(v.tipo);
  }
  await conferirAtendimento(tx, est, e.atendimento, e.paciente);
  const at = e.atendimento
    ? await tx.uma<{ setor_funcional_id: unknown }>(
        'SELECT setor_funcional_id FROM atendimento WHERE id = ?',
        [e.atendimento],
      )
    : null;
  const setor = numOuNulo(at?.setor_funcional_id);
  const pessoa = await tx.uma<{ sexo: unknown; data_nascimento: unknown }>(
    `SELECT s.codigo AS sexo, pf.data_nascimento FROM paciente p
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id LEFT JOIN sexo s ON s.id = pf.sexo_id
      WHERE p.id = ?`,
    [e.paciente],
  );
  const sexo = pessoa?.sexo === 'feminino' || pessoa?.sexo === 'masculino' ? pessoa.sexo : null;
  const nascimento = dataDe(pessoa?.data_nascimento);
  const fuso = await fusoDe(tx, est);
  const idade = idadeEmDias(nascimento, e.horaReal);

  const linhas: {
    tipo: string;
    valores: Record<string, unknown>;
    nivel: 'normal' | 'atencao' | 'critico' | null;
    limite: number | null;
  }[] = [];
  for (const v of e.valores) {
    const pv = await tx.uma<Linha>(
      `SELECT id, descricao, valor_minimo, valor_maximo, alerta_minimo, alerta_maximo, exige_local_afericao,
              exige_posicao_paciente
         FROM parametro_vital WHERE codigo = ? AND ativo`,
      [v.tipo],
    );
    if (!pv) throw recusa('cadastro-incompleto', `O cadastro dos parâmetros vitais não tem "${v.tipo}".`);
    const parametro = num(pv['id']);
    const rotulo = `${texto(pv['descricao'])}: `;
    const regraSetor = setor
      ? await tx.uma<Linha>(
          `SELECT exige_local_afericao, exige_posicao_afericao FROM parametro_vital_setor
            WHERE setor_funcional_id = ? AND parametro_vital_id = ? AND ativo`,
          [setor, parametro],
        )
      : null;
    const regra = regraSetor
      ? {
          exigeLocal: booleano(regraSetor['exige_local_afericao']),
          exigePosicao: booleano(regraSetor['exige_posicao_afericao']),
        }
      : {
          exigeLocal: booleano(pv['exige_local_afericao']),
          exigePosicao: booleano(pv['exige_posicao_paciente']),
        };
    const motivo =
      v.motivo === null
        ? null
        : await tx.uma<{ id: number; exige_complemento: unknown }>(
            'SELECT id, exige_complemento FROM motivo_nao_afericao WHERE id = ? AND ativo',
            [v.motivo],
          );
    if (v.motivo !== null && !motivo)
      throw recusa('motivo-inexistente', `${rotulo}o motivo de não aferir não está no cadastro.`);
    primeiroErro(
      conferirDetalheAfericao(
        {
          valor: v.valor,
          local: v.local,
          posicao: v.posicao,
          naoAferido: v.naoAferido,
          motivoNaoAfericao: motivo
            ? { id: Number(motivo.id), exigeComplemento: booleano(motivo.exige_complemento) }
            : null,
          justificativa: v.justificativa,
        },
        regra,
      ),
      rotulo,
    );
    if (v.instrumento !== null) {
      const i = await tx.uma<{ parametro_vital_id: unknown }>(
        'SELECT parametro_vital_id FROM instrumento_afericao WHERE id = ? AND ativo',
        [v.instrumento],
      );
      if (!i) throw recusa('instrumento-inexistente', `${rotulo}o instrumento não está no cadastro.`);
      if (i.parametro_vital_id !== null && Number(i.parametro_vital_id) !== parametro)
        throw recusa('instrumento-de-outro-parametro', `${rotulo}o instrumento mede outro parâmetro.`);
    }
    if (
      v.local !== null &&
      !(await tx.uma('SELECT id FROM local_afericao WHERE id = ? AND ativo', [v.local]))
    )
      throw recusa('local-inexistente', `${rotulo}o local da aferição não está no cadastro.`);
    if (
      v.posicao !== null &&
      !(await tx.uma('SELECT id FROM posicao_afericao WHERE id = ? AND ativo', [v.posicao]))
    )
      throw recusa('posicao-inexistente', `${rotulo}a posição não está no cadastro.`);

    let nivel: 'normal' | 'atencao' | 'critico' | null = null;
    let limite: number | null = null;
    if (!v.naoAferido && v.valor !== null) {
      // Faixa plausível: a do vocabulário (erro de digitação) e a do cadastro do parâmetro.
      if (v.tipo in SINAIS_VITAIS) {
        const p = validarSinal({
          tipo: v.tipo as TipoSinalVital,
          valor: v.valor,
          confirmadoForaDaFaixa: true,
        });
        if (!p.ok) throw recusa(p.codigo, p.mensagem);
      }
      const min = decimal(pv['valor_minimo']);
      const max = decimal(pv['valor_maximo']);
      if ((min !== null && v.valor < min) || (max !== null && v.valor > max))
        throw recusa(
          'sinal-implausivel',
          `${rotulo}o valor está fora da faixa aceita pelo cadastro; confira.`,
        );
      const limites = (
        await tx.consultar(
          `SELECT ${COLUNAS_LIMITE} FROM limite_parametro_vital l
            WHERE l.parametro_vital_id = ? AND l.ativo AND (l.estabelecimento_id IS NULL OR l.estabelecimento_id = ?)`,
          [parametro, est],
        )
      ).map(limiteDe);
      const n = nivelDaAfericao(
        v.valor,
        limites,
        { estabelecimento: est, setor, instrumento: v.instrumento, sexo, idadeDias: idade },
        { alertaMinimo: decimal(pv['alerta_minimo']), alertaMaximo: decimal(pv['alerta_maximo']) },
      );
      if (n.nivel !== 'normal' && !v.confirmadoForaDaFaixa)
        throw recusa(
          'sinal-confirmar',
          `${rotulo}o valor está ${n.nivel === 'critico' ? 'na faixa crítica' : 'fora da faixa normal'}; confirme o valor.`,
        );
      nivel = n.nivel;
      limite = n.limite;
    }
    linhas.push({
      tipo: v.tipo,
      nivel,
      limite,
      valores: {
        parametro_vital_id: parametro,
        valor_numerico: v.naoAferido ? null : v.valor,
        instrumento_afericao_id: v.instrumento,
        local_afericao_id: v.local,
        posicao_afericao_id: v.posicao,
        nivel_alerta: nivel,
        nao_aferido: v.naoAferido,
        motivo_nao_afericao_id: v.naoAferido ? v.motivo : null,
        justificativa_nao_afericao: v.naoAferido ? v.justificativa?.trim() || null : null,
      },
    });
  }
  const afericao = await tx.incluir('afericao', {
    estabelecimento_id: est,
    paciente_id: e.paciente,
    atendimento_id: e.atendimento,
    setor_funcional_id: setor,
    profissional_id: await exigirProfissional(tx, tx.contexto, est),
    aferido_em: instanteDe(`${e.horaReal.slice(0, 16)}:00`, fuso),
    fonte: 'manual',
    finalizada: true,
    observacao: e.observacao,
  });
  const feitos: AfericaoFeita['valores'][number][] = [];
  for (const [i, x] of linhas.entries()) {
    const id = await tx.incluir('afericao_valor', { afericao_id: afericao, sequencia: i + 1, ...x.valores });
    feitos.push({ id, tipo: x.tipo, nivel: x.nivel, limite: x.limite });
  }
  an.dados = {
    afericao,
    setor,
    valores: feitos.map((f) => ({ tipo: f.tipo, nivel: f.nivel, limite: f.limite })),
  };
  return { afericao, setor, valores: feitos };
}

export interface ValorAfericaoLido {
  readonly id: number;
  readonly afericao: number;
  readonly aferidoEm: string | null;
  readonly tipo: string;
  readonly descricao: string;
  readonly unidade: string | null;
  readonly valor: number | null;
  readonly nivel: string | null;
  readonly instrumento: string | null;
  readonly local: string | null;
  readonly posicao: string | null;
  readonly naoAferido: boolean;
  readonly motivo: string | null;
  readonly justificativa: string | null;
}

/** As aferições detalhadas recentes do paciente neste estabelecimento (vigentes), da mais nova para a mais antiga. */
export async function afericoesDoPaciente(
  l: Leitor,
  est: number,
  paciente: number,
  limite = 100,
): Promise<ValorAfericaoLido[]> {
  const fuso = await fusoDe(l, est);
  const rs = await l.consultar(
    `SELECT v.id, v.afericao_id, a.aferido_em, p.codigo, p.descricao, p.unidade, v.valor_numerico, v.nivel_alerta,
            i.descricao AS instrumento, lo.descricao AS local_desc, po.descricao AS posicao, v.nao_aferido,
            m.descricao AS motivo, v.justificativa_nao_afericao
       FROM afericao a
       JOIN afericao_valor v ON v.afericao_id = a.id AND v.excluido_em IS NULL
       JOIN parametro_vital p ON p.id = v.parametro_vital_id
       LEFT JOIN instrumento_afericao i ON i.id = v.instrumento_afericao_id
       LEFT JOIN local_afericao lo ON lo.id = v.local_afericao_id
       LEFT JOIN posicao_afericao po ON po.id = v.posicao_afericao_id
       LEFT JOIN motivo_nao_afericao m ON m.id = v.motivo_nao_afericao_id
      WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
      ORDER BY a.aferido_em DESC, v.sequencia
      LIMIT ${Math.max(1, Math.min(500, Math.trunc(limite)))}`,
    [paciente, est],
  );
  return rs.map((r) => ({
    id: num(r['id']),
    afericao: num(r['afericao_id']),
    aferidoEm: civilDe(r['aferido_em'], fuso),
    tipo: texto(r['codigo']),
    descricao: texto(r['descricao']),
    unidade: textoOuNulo(r['unidade']),
    valor: decimal(r['valor_numerico']),
    nivel: textoOuNulo(r['nivel_alerta']),
    instrumento: textoOuNulo(r['instrumento']),
    local: textoOuNulo(r['local_desc']),
    posicao: textoOuNulo(r['posicao']),
    naoAferido: booleano(r['nao_aferido']),
    motivo: textoOuNulo(r['motivo']),
    justificativa: textoOuNulo(r['justificativa_nao_afericao']),
  }));
}
