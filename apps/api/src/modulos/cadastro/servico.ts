// Regras das telas do cadastro na API (M11): a busca única (termo → índice ou busca direta, casamento por
// palavra, sugestão fonética), o mascaramento por permissão (cap-08 §8.13; regra 9), a ficha, a linha do
// tempo e a fila de duplicidades. As regras puras vêm de @sgh/dominio-cadastro; os dados, da porta (banco do
// cliente ou memória). Nada aqui conhece tabela.
import {
  type CampoBusca,
  type CandidatosCpf,
  CAMPOS_ALTERAVEIS_PACIENTE,
  type ConsultaBuscaPaciente,
  type FichaPaciente,
  type FilaDuplicidades,
  type HistoricoCadastro,
  type PacienteResumo,
  type ParDuplicidade,
  type ResultadoBuscaPaciente,
  TETO_BUSCA_PACIENTE,
} from '@sgh/contratos';
import {
  casaPalavras,
  chaveFonetica,
  type CampoHistorico,
  cnsDoLegado,
  entraNaFila,
  ErroTermo,
  escoreDuplicidade,
  formatarCpf,
  interpretarTermo,
  mascararCns,
  mascararCpf,
  mascararNome,
  mascararTelefone,
  mudancasEntreVersoes,
  palavraMaisSeletiva,
  palavrasDoCadastro,
  type PermissoesFicha,
  sugerirFoneticos,
} from '@sgh/dominio-cadastro';

import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta, PortaCadastro } from './porta.js';
import type { PacienteFicha, ParCandidato, ParFila, RegistroTrilhaTela } from './tipos.js';

const NOME: readonly CampoBusca[] = ['nome', 'social'];
const MAE: readonly CampoBusca[] = ['mae'];

/** Situação do cadastro: ativo, inativo ou absorvido numa unificação. */
function situacao(p: PacienteFicha): PacienteResumo['situacao'] {
  if (p.unificadoEm !== null) return 'unificado';
  return p.ativo ? 'ativo' : 'inativo';
}

export function resumoDoPaciente(p: PacienteFicha, homonimos: ReadonlySet<number>): PacienteResumo {
  return {
    id: p.id,
    prontuario: p.prontuario,
    nome: p.nome,
    nomeSocial: p.nomeSocial,
    nascimento: p.nascimento,
    sexo: p.sexo,
    maeMascarada: mascararNome(p.mae),
    cpfMascarado: mascararCpf(p.cpf),
    telefoneMascarado: mascararTelefone(p.celular ?? p.telefone),
    situacao: situacao(p),
    obito: p.obito !== null,
    homonimo: homonimos.has(p.id),
  };
}

/** Candidatos lidos da busca por palavras (a tela mostra 50; acima disso, "refine a busca"). */
const TETO_CANDIDATOS = 150;

function termoOuErro(q: ConsultaBuscaPaciente): ReturnType<typeof interpretarTermo> {
  try {
    return interpretarTermo(q.termo, q.tipo);
  } catch (e) {
    if (e instanceof ErroTermo)
      throw new ErroProblema('entrada-invalida', 400, 'Termo de busca inválido', e.message, {
        codigo: e.codigo,
      });
    throw e;
  }
}

export async function buscarPacientes(
  porta: PortaCadastro,
  c: ContextoPorta,
  q: ConsultaBuscaPaciente,
): Promise<ResultadoBuscaPaciente> {
  const inicio = performance.now();
  const t = termoOuErro(q);
  const inativos = q.inativos === 'sim';
  let pacientes: PacienteFicha[];
  let sugestoes: PacienteFicha[] = [];
  let truncado: boolean;
  if (t.tipo === 'cpf' || t.tipo === 'prontuario' || t.tipo === 'cns' || t.tipo === 'nascimento') {
    const r = await porta.buscarDireto(c, t, inativos);
    pacientes = r.pacientes;
    truncado = r.truncado;
  } else if (t.tipo === 'telefone') {
    const r = await porta.idsPorPalavra(c, 'paciente', ['telefone'], t.ultimos8);
    pacientes = await porta.lerPacientes(c, [...r.ids].slice(0, TETO_BUSCA_PACIENTE + 1));
    truncado = r.ids.size > TETO_BUSCA_PACIENTE;
  } else {
    const campos = t.tipo === 'mae' ? MAE : NOME;
    // Uma consulta no índice com TODAS as palavras (até 150 candidatos); a regra exata (palavra inteira,
    // prefixo de 4, inicial; todas no mesmo nome, civil ou social) é conferida no nome lido.
    const r = await porta.idsPorPalavras(c, 'paciente', campos, t.palavras, TETO_CANDIDATOS);
    truncado = r.truncado;
    const candidatos = await porta.lerPacientes(c, r.ids);
    pacientes = candidatos.filter((p) => {
      const nomes = t.tipo === 'mae' ? [p.mae] : [p.nome, p.nomeSocial];
      return nomes.some((n) => casaPalavras(t.palavras, palavrasDoCadastro(n)));
    });
    if (pacientes.length === 0) {
      // Sugestão fonética (regra 5): pela palavra mais seletiva, conferida em todas as palavras; até 5.
      const p = palavraMaisSeletiva(t.palavras);
      if (p) {
        const f = await porta.idsPorFonetica(c, 'paciente', campos, chaveFonetica(p), 200);
        const cands = await porta.lerPacientes(c, [...f.ids].slice(0, 200));
        sugestoes = sugerirFoneticos(q.termo, cands, (x) => (t.tipo === 'mae' ? (x.mae ?? '') : x.nome));
      }
    }
  }
  const visiveis = pacientes
    .filter((p) => inativos || p.ativo)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (visiveis.length > TETO_BUSCA_PACIENTE) truncado = true;
  const lista = visiveis.slice(0, TETO_BUSCA_PACIENTE);
  const homonimos = await porta.homonimos(
    c,
    [...lista, ...sugestoes].map((x) => x.id),
  );
  return {
    tipo: t.tipo,
    itens: lista.map((p) => resumoDoPaciente(p, homonimos)),
    sugestoes: sugestoes.map((p) => resumoDoPaciente(p, homonimos)),
    truncado,
    duracaoMs: Math.round(performance.now() - inicio),
  };
}

export async function candidatosDoCpf(
  porta: PortaCadastro,
  c: ContextoPorta,
  cpf: number,
): Promise<CandidatosCpf> {
  const r = await porta.candidatosPorCpf(c, cpf);
  return {
    candidatos: r.map((p) => ({
      id: p.id,
      prontuario: p.prontuario,
      nomeMascarado: mascararNome(p.nome) ?? '',
      nascimento: p.nascimento,
    })),
  };
}

export async function montarFicha(
  porta: PortaCadastro,
  c: ContextoPorta,
  id: number,
  perm: PermissoesFicha,
  login: string,
): Promise<FichaPaciente | null> {
  const [p] = await porta.lerPacientes(c, [id]);
  if (!p) return null;
  const x = await porta.extrasDaFicha(c, p);
  // A mesma regra do passo 0 do executor (a chave de liberação é a da operação: cadastro.cadastrarPaciente e
  // cadastro.alterarPaciente; M11 D-LIB-1): a ficha esconde "Editar" e mostra o motivo antes de a pessoa digitar.
  const cad = await porta.podeGravar(c, 'cadastro.cadastrarPaciente', login);
  const alt = await porta.podeGravar(c, 'cadastro.alterarPaciente', login);
  const ativo = p.ativo && p.unificadoEm === null;
  return {
    id: p.id,
    prontuario: p.prontuario,
    prontuarioAnterior: p.prontuarioAnterior,
    situacao: situacao(p),
    unificadoEm: p.unificadoEm,
    // Sem verDocumento, a versão opaca não leva CPF nem identidade (o carimbo do trigger segue detectando a colisão).
    versao: porta.versaoParaTela(p.versao, perm.verDocumento),
    identificacao: {
      nome: p.nome,
      nomeSocial: p.nomeSocial,
      nascimento: p.nascimento,
      sexo: p.sexo,
      estadoCivil:
        p.estadoCivil !== null && x.estadoCivil ? { codigo: p.estadoCivil, rotulo: x.estadoCivil } : null,
      naturalidade: p.naturalidade,
      ufNaturalidade: p.ufNaturalidade,
      nacionalidade: p.nacionalidade,
      estrangeiro: p.nacionalidadeCodigo !== null && p.nacionalidadeCodigo !== 10,
    },
    filiacao: { mae: p.mae, maeDesconhecida: p.maeDesconhecida, pai: p.pai },
    documentos: perm.verDocumento
      ? {
          cpf: p.cpf ? formatarCpf(p.cpf) : null,
          cns: cnsDoLegado(p.cns),
          identidade: p.identidade,
          mascarados: false,
        }
      : { cpf: mascararCpf(p.cpf), cns: mascararCns(cnsDoLegado(p.cns)), identidade: null, mascarados: true },
    endereco: {
      cep: p.cep,
      logradouro: p.logradouro,
      numero: p.numero,
      complemento: p.complemento,
      bairro: p.bairro,
      cidade: p.cidade,
      uf: p.uf,
    },
    contatos: { telefone: p.telefone, celular: p.celular, email: p.email },
    responsavel: { nome: p.contatoNome, telefone: p.contatoTelefone },
    sensiveis: perm.verSensivel
      ? {
          racaCor: p.racaCor !== null ? { codigo: p.racaCor, rotulo: x.racaCor ?? String(p.racaCor) } : null,
          religiao:
            p.religiao !== null ? { codigo: p.religiao, rotulo: x.religiao ?? String(p.religiao) } : null,
          responsavelLegal: p.responsavelLegal,
        }
      : null,
    carteirinhas: [...x.carteirinhas],
    clinicoLegado: { alergia: p.alergia, medicamentos: p.medicamentos },
    obito: p.obito
      ? { data: p.obito, declaracao: p.obitoDeclaracao ?? null, causa: p.obitoCausa ?? null }
      : null,
    cadastro: { em: p.cadastradoEm, alteradoEm: p.alteradoEm },
    permissoes: { ...perm },
    gravacao: {
      cadastrar: cad.pode,
      alterar: alt.pode && ativo,
      motivo: !alt.pode
        ? (alt.motivo ?? 'A alteração do cadastro não está liberada neste estabelecimento.')
        : !ativo
          ? 'Cadastro absorvido numa unificação: altere o cadastro que ficou ativo.'
          : null,
    },
  };
}

/** Campos da linha do tempo (retrato do cadastro, pelo nome do campo) com o rótulo e a restrição. */
export const CAMPOS_HISTORICO_PACIENTE: readonly CampoHistorico[] = [
  { coluna: 'nome', campo: 'nome', rotulo: 'Nome' },
  { coluna: 'nomeSocial', campo: 'nomeSocial', rotulo: 'Nome social' },
  { coluna: 'nascimento', campo: 'nascimento', rotulo: 'Nascimento' },
  { coluna: 'sexo', campo: 'sexo', rotulo: 'Sexo' },
  { coluna: 'nomeMae', campo: 'nomeMae', rotulo: 'Nome da mãe' },
  { coluna: 'nomePai', campo: 'nomePai', rotulo: 'Nome do pai' },
  { coluna: 'maeDesconhecida', campo: 'maeDesconhecida', rotulo: 'Mãe desconhecida' },
  { coluna: 'cpf', campo: 'cpf', rotulo: 'CPF', restricao: 'documento' },
  { coluna: 'cns', campo: 'cns', rotulo: 'CNS', restricao: 'documento' },
  { coluna: 'identidade', campo: 'identidade', rotulo: 'Identidade', restricao: 'documento' },
  { coluna: 'estadoCivil', campo: 'estadoCivil', rotulo: 'Estado civil' },
  { coluna: 'naturalidade', campo: 'naturalidade', rotulo: 'Naturalidade' },
  { coluna: 'ufNaturalidade', campo: 'ufNaturalidade', rotulo: 'UF de naturalidade' },
  { coluna: 'cep', campo: 'cep', rotulo: 'CEP' },
  { coluna: 'logradouro', campo: 'logradouro', rotulo: 'Logradouro' },
  { coluna: 'numero', campo: 'numero', rotulo: 'Número' },
  { coluna: 'complemento', campo: 'complemento', rotulo: 'Complemento' },
  { coluna: 'bairro', campo: 'bairro', rotulo: 'Bairro' },
  { coluna: 'email', campo: 'email', rotulo: 'E-mail' },
  { coluna: 'racaCor', campo: 'racaCor', rotulo: 'Raça/cor', restricao: 'sensivel' },
  { coluna: 'religiao', campo: 'religiao', rotulo: 'Religião', restricao: 'sensivel' },
  { coluna: 'etnia', campo: 'etnia', rotulo: 'Etnia', restricao: 'sensivel' },
  {
    coluna: 'responsavelLegal',
    campo: 'responsavelLegal',
    rotulo: 'Responsável legal',
    restricao: 'sensivel',
  },
  { coluna: 'obito', campo: 'obito', rotulo: 'Óbito' },
];

const TIPOS_TELEFONE: Readonly<Record<number, string>> = { 1: 'fixo', 3: 'celular', 5: 'contato' };

export async function montarHistorico(
  porta: PortaCadastro,
  c: ContextoPorta,
  id: number,
  pagina: number,
  porPagina: number,
  perm: Pick<PermissoesFicha, 'verDocumento' | 'verSensivel'>,
): Promise<HistoricoCadastro | null> {
  const [p] = await porta.lerPacientes(c, [id]);
  if (!p) return null;
  const h = await porta.historico(c, id, pagina, porPagina);
  const permite = { documento: perm.verDocumento, sensivel: perm.verSensivel };
  const versoes = h.versoes.map((v, i) => {
    const anterior = h.versoes[i + 1] ?? h.anterior;
    return {
      id: v.id,
      em: v.em ?? '',
      usuario: v.usuario,
      mudancas: mudancasEntreVersoes(
        anterior?.valores ?? null,
        v.valores,
        CAMPOS_HISTORICO_PACIENTE,
        permite,
      ),
      telefones: v.telefones.map((t) => ({
        tipo: TIPOS_TELEFONE[t.tipo] ?? `tipo ${t.tipo}`,
        numero: perm.verDocumento ? t.numero : (mascararTelefone(t.numero) ?? ''),
      })),
    };
  });
  return {
    id,
    nome: p.nome,
    versoes,
    pagina,
    porPagina,
    total: h.total,
    unificacoes: await porta.unificacoes(c, id),
  };
}

function ladoDuplicidade(p: PacienteFicha | undefined, id: number): ParDuplicidade['a'] {
  return {
    id,
    prontuario: p?.prontuario ?? 0,
    nome: p?.nome ?? '(cadastro não encontrado)',
    nascimento: p?.nascimento ?? null,
    mae: p?.mae ?? null,
    cpfMascarado: mascararCpf(p?.cpf ?? null),
    telefoneMascarado: mascararTelefone(p?.celular ?? p?.telefone ?? null),
    cidade: p?.cidade ?? null,
    situacao: p ? situacao(p) : 'inativo',
  };
}

/** Pares da fila com os dois lados (nome, nascimento, mãe; CPF e telefone mascarados). */
export async function montarPares(
  porta: PortaCadastro,
  c: ContextoPorta,
  pares: readonly ParFila[],
): Promise<ParDuplicidade[]> {
  const pacientes = new Map(
    (
      await porta.lerPacientes(
        c,
        pares.flatMap((x) => [x.a, x.b]),
      )
    ).map((p) => [p.id, p]),
  );
  return pares.map((x) => ({
    id: x.id,
    a: ladoDuplicidade(pacientes.get(x.a), x.a),
    b: ladoDuplicidade(pacientes.get(x.b), x.b),
    escore: x.escore,
    criterios: x.criterios.filter((k): k is ParDuplicidade['criterios'][number] =>
      ['cpf', 'fonetica', 'nascimento', 'mae', 'telefone'].includes(k),
    ),
    situacao: x.situacao,
    decididoPor: x.decididoPor,
    decididoEm: x.decididoEm,
  }));
}

export async function montarFila(
  porta: PortaCadastro,
  c: ContextoPorta,
  situacaoPedida: ParFila['situacao'],
  pagina: number,
  porPagina: number,
): Promise<FilaDuplicidades> {
  const f = await porta.lerFila(c, situacaoPedida, pagina, porPagina);
  const estado = porta.estado('cadastro.unificarPaciente', c.hospital) ?? 'especificada';
  return {
    itens: await montarPares(porta, c, f.itens),
    total: f.total,
    unificacao: {
      estado,
      disponivel: estado === 'liberada',
      motivo:
        estado === 'liberada'
          ? 'Unificação liberada neste estabelecimento.'
          : 'A unificação de prontuários ainda não está liberada neste estabelecimento: compare lado a lado e marque "É outra pessoa" quando for o caso.',
    },
  };
}

/** Pares novos pela regra do escore (CPF primeiro), sem os já na fila; os inativos viram "unificado no legado". */
export async function atualizarFila(
  porta: PortaCadastro,
  c: ContextoPorta,
  trilha: RegistroTrilhaTela,
): Promise<{ novos: number; total: number }> {
  const g = await porta.gruposCandidatos(c);
  const ids = [...new Set([...g.cpf.flat(), ...g.fonetica.flat()])];
  const pacientes = new Map<number, PacienteFicha>();
  for (let i = 0; i < ids.length; i += 500)
    for (const p of await porta.lerPacientes(c, ids.slice(i, i + 500))) pacientes.set(p.id, p);
  const pares: ParCandidato[] = [];
  const vistos = new Set<string>();
  for (const grupo of [...g.cpf, ...g.fonetica]) {
    for (let i = 0; i < grupo.length; i++)
      for (let j = i + 1; j < grupo.length; j++) {
        const a = pacientes.get(grupo[i] as number);
        const b = pacientes.get(grupo[j] as number);
        if (!a || !b) continue;
        const k = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        const e = escoreDuplicidade(
          {
            id: a.id,
            nome: a.nome,
            nascimento: a.nascimento,
            mae: a.mae,
            cpf: a.cpf,
            telefones: [a.telefone, a.celular],
          },
          {
            id: b.id,
            nome: b.nome,
            nascimento: b.nascimento,
            mae: b.mae,
            cpf: b.cpf,
            telefones: [b.telefone, b.celular],
          },
        );
        if (!entraNaFila(e)) continue;
        pares.push({
          a: { id: a.id, pront: a.prontuario },
          b: { id: b.id, pront: b.prontuario },
          escore: e.escore,
          criterios: e.criterios,
        });
      }
  }
  const inativos = [...pacientes.values()].filter((p) => !p.ativo || p.unificadoEm !== null).map((p) => p.id);
  const novos = await porta.gravarPares(c, pares, inativos, trilha);
  return { novos, total: pares.length };
}

/** Rótulo do campo da ficha (aviso de colisão: o que mudou, em português). */
export const ROTULOS_CAMPOS_PACIENTE: Readonly<
  Record<(typeof CAMPOS_ALTERAVEIS_PACIENTE)[number] | 'situacao' | 'versao', string>
> = {
  nome: 'Nome',
  nascimento: 'Nascimento',
  sexo: 'Sexo',
  nomeMae: 'Nome da mãe',
  naturalidade: 'Naturalidade',
  ufNaturalidade: 'UF de naturalidade',
  cpf: 'CPF',
  identidade: 'Identidade',
  estadoCivil: 'Estado civil',
  cep: 'CEP',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  telefone: 'Telefone',
  celular: 'Celular',
  email: 'E-mail',
  contatoNome: 'Responsável/contato',
  contatoTelefone: 'Telefone do contato',
  situacao: 'Situação do cadastro',
  versao: 'Versão lida',
};
