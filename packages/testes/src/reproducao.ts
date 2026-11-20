// Reprodução dos cenários de assinatura das operações do catálogo pelo EXECUTOR (ficha do M04, item 9;
// roteiro 6.3, passo 4): cada cenário monta a massa sintética na mesma transação da captura (preparar, antes
// do retrato "antes"), chama o executor com o escritor da captura (tudo é desfeito no fim) e devolve os
// valores que o novo pôs em cada coluna (em memória: viram a classe `entrada` na normalização). Cenário de
// recusa: o executor tem de recusar com o código esperado e nada pode mudar.
import {
  type CenarioCaptura,
  carregarDominiosVistos,
  type ContextoOperacao,
  ErroOperacao,
  type Escritor,
  type Executor,
  lerPaciente,
  operacao,
  OPERACOES_DOMINIOS,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { cenarioDeCatalogo, OPERACOES_REPRODUCAO_CATALOGOS } from './massa/reproducao-catalogos.js';
import { cenarioDeDominio } from './massa/reproducao-dominios.js';
import { cenarioDePermissao, OPERACOES_REPRODUCAO_PERMISSOES } from './massa/reproducao-permissoes.js';
import { cenarioM10, OPERACOES_REPRODUCAO_M10 } from './massa/reproducao-m10.js';
import { cenarioM59, OPERACOES_REPRODUCAO_M59 } from './massa/reproducao-m59.js';
import { cenarioM59F3, OPERACOES_REPRODUCAO_M59_F3 } from './massa/reproducao-m59-f3.js';
import { cenarioPep, OPERACOES_REPRODUCAO_PEP } from './massa/reproducao-pep.js';
import { cenarioPrescricao, OPERACOES_REPRODUCAO_PRESCRICAO } from './massa/reproducao-prescricao.js';
import { cenarioAgenda, OPERACOES_REPRODUCAO_AGENDA } from './massa/reproducao-agenda.js';
import { cenarioPepM23, OPERACOES_REPRODUCAO_PEP_M23 } from './massa/reproducao-pep-m23.js';
import { cenarioRecepcao, OPERACOES_REPRODUCAO_RECEPCAO } from './massa/reproducao-recepcao.js';
import { cenarioExame, OPERACOES_REPRODUCAO_EXAME } from './massa/reproducao-exame.js';
import { cenarioCirurgia, OPERACOES_REPRODUCAO_CIRURGIA } from './massa/reproducao-cirurgia.js';
import { cenarioAtendimento, OPERACOES_REPRODUCAO_ATENDIMENTO } from './massa/reproducao-atendimento.js';
import { cenarioSadt, OPERACOES_REPRODUCAO_SADT } from './massa/reproducao-sadt.js';
import { cenarioDicionario, OPERACOES_REPRODUCAO_DICIONARIO } from './massa/reproducao-dicionario.js';
import { cenarioInternacao, OPERACOES_REPRODUCAO_INTERNACAO } from './massa/reproducao-internacao.js';
import { cenarioEnfermagem, OPERACOES_REPRODUCAO_ENFERMAGEM } from './massa/reproducao-enfermagem.js';
import { cenarioW108, OPERACOES_REPRODUCAO_W108 } from './massa/reproducao-w108.js';
import { cenarioSuprimentos, OPERACOES_REPRODUCAO_SUPRIMENTOS } from './massa/reproducao-suprimentos.js';
import { cenarioFarmacia, OPERACOES_REPRODUCAO_FARMACIA } from './massa/reproducao-farmacia.js';
import { cenarioFaturamento, OPERACOES_REPRODUCAO_FATURAMENTO } from './massa/reproducao-faturamento.js';
import { cenarioTiss, OPERACOES_REPRODUCAO_TISS } from './massa/reproducao-tiss.js';
import { cenarioFinanceiro, OPERACOES_REPRODUCAO_FINANCEIRO } from './massa/reproducao-financeiro.js';
import { cenarioRepasse, OPERACOES_REPRODUCAO_REPASSE } from './massa/reproducao-repasse.js';
import {
  contratoAtivo,
  convenioComDiariaInvalida,
  convenioNaSituacao,
  entradaReajuste,
  hojeDoBanco,
  itensDaTabela,
  itensModeloCh,
  MARCA_M12,
  mexerPorFora,
} from './massa/precos.js';
import {
  atendimentoExistente,
  cepCompleto,
  cepInexistente,
  cpfLivre,
  ESTACAO_SINTETICA,
  loginExiste,
  loginLivre,
  MARCA_SINTETICA,
  NOME_ACENTUADO,
  outroCepCompleto,
  pacienteSintetico,
  papelSintetico,
  usuarioSintetico,
} from './massa/sintetica.js';

export interface ContextoReproducao {
  readonly executor: Executor;
  readonly rede: string;
  readonly hospital: string;
  /** TBUSERS.NOME do operador sintético (não existe no legado: TBUSUCPL não numera PRTANT para ele). */
  readonly operador?: string;
}

export interface CenarioReproduzido {
  readonly cenario: CenarioCaptura;
  /** Colunas → valores que o novo pôs (depois da execução; em memória). */
  entradas(): Record<string, unknown>;
}

export const OPERADOR_SINTETICO = 'SGH.REPRODUCAO';

const INSERCAO =
  /^\s*INSERT\s+INTO\s+"?([A-Za-z0-9_$]+)"?\s*\(([^)]*)\)\s*VALUES\s*\((.*)\)(?:\s+RETURNING\b.*)?\s*$/is;
/** M08: UPDATE <T> SET A = ?, B = ? WHERE … (receita genérica: alterar e inativar). */
const ATUALIZACAO = /^\s*UPDATE\s+"?([A-Za-z0-9_$]+)"?\s+SET\s+(.*?)\s+WHERE\s+/is;

/** Escritor que anota as colunas e os parâmetros das inclusões em tabela legada (não SGH_). */
export function escritorAnotado(
  e: Escritor,
  anotar: (tabela: string, valores: Record<string, unknown>) => void,
): Escritor {
  const ver = (sql: string, p: readonly unknown[]) => {
    const u = ATUALIZACAO.exec(sql);
    if (u?.[1] && !u[1].toUpperCase().startsWith('SGH_')) {
      const valores: Record<string, unknown> = {};
      let i = 0;
      for (const parte of (u[2] ?? '').split(',')) {
        const [col = '', expr = ''] = parte.split('=').map((x) => x.trim());
        if (expr === '?') valores[col.toUpperCase()] = p[i++];
      }
      anotar(u[1].toUpperCase(), valores);
      return;
    }
    const m = INSERCAO.exec(sql);
    if (!m?.[1] || m[1].toUpperCase().startsWith('SGH_')) return;
    const cols = (m[2] ?? '').split(',').map((c) => c.trim().toUpperCase());
    const marcas = (m[3] ?? '').split(',').map((c) => c.trim());
    const valores: Record<string, unknown> = {};
    let i = 0;
    cols.forEach((c, k) => {
      if (marcas[k] === '?') valores[c] = p[i++];
    });
    anotar(m[1].toUpperCase(), valores);
  };
  return {
    ...e,
    consultar: (sql, p, o) => e.consultar(sql, p, o),
    lerBlob: (b) => e.lerBlob(b),
    executar: (sql, p = []) => {
      ver(sql, p);
      return e.executar(sql, p);
    },
    executarRetornando: (sql, p = []) => {
      ver(sql, p);
      return e.executarRetornando(sql, p);
    },
  };
}

let seq = 0;
const chave = (cenario: string) => `repro-${cenario}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function contexto(c: ContextoReproducao, cenario: string, operador?: string): ContextoOperacao {
  return {
    rede: c.rede,
    hospital: c.hospital,
    traceId: `assinatura-${cenario}`.slice(0, 64),
    usuarioLegado: operador ?? c.operador ?? OPERADOR_SINTETICO,
    idempotencyKey: chave(cenario),
    // Reprodução sintética: o operador da captura conta como recém-reautenticado (operação crítica).
    reautenticadoEm: Date.now(),
  };
}

/**
 * Operador sintético em TBUSERS (FK_RICADPAC_TBUSERS exige o login de quem cadastra): criado pelo próprio
 * executor (acesso.criarUsuarioIntegracao) na transação da captura, antes do retrato; desfeito no fim.
 */
async function operadorSintetico(c: ContextoReproducao, e: Escritor, fixo?: string): Promise<string> {
  // W0-10: com `fixo` (o usuário do portal), reaproveita o login se a cópia já o tiver; senão o cria como a implantação
  // cria o usuário de integração (FK_SIPACAGD_TBUSERS exige o login de quem marca), também desfeito no fim.
  if (fixo) {
    if (await loginExiste(e, fixo)) return fixo;
  }
  const login = fixo ?? (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
  await c.executor.executar(
    operacao('acesso.criarUsuarioIntegracao'),
    c.hospital,
    usuarioSintetico('usuario-tecnico', login),
    contexto(c, 'operador'),
    { escritor: e },
  );
  return login;
}

/** Executa e exige a recusa com o código esperado (nada gravado). */
async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

const tiposLogradouro = (() => {
  let s: ReadonlySet<string> | null = null;
  return () =>
    (s ??=
      carregarDominiosVistos(resolve(import.meta.dirname, '../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
      new Set<string>());
})();

export function cenarioDeOperacao(nome: string, cenario: string, c: ContextoReproducao): CenarioReproduzido {
  const op = operacao(nome);
  if (!op.receita.cenarios.some((x) => x.nome === cenario)) {
    throw new Error(`Cenário ${cenario} não está na receita de ${nome}.`);
  }
  // Colunas de todas as tabelas dos passos (M06: o detalhe da trilha é o segundo passo).
  const tabelasDosPassos = new Set(op.receita.passos.map((p) => p.tabela));
  const classes: Record<string, { classe: string }> = Object.assign(
    {},
    ...op.receita.passos.map((p) => p.colunas),
  );
  let postos: Record<string, unknown> = {};
  // M13 (receita de carga): todos os valores postos por coluna, de todas as linhas (comparados como a
  // normalização compara: data em ISO, texto sem os espaços das pontas).
  const todos: Record<string, Set<string>> = {};
  const chaveValor = (v: unknown) =>
    v instanceof Date ? v.toISOString() : typeof v === 'string' ? v.trim() : String(v);
  const anotar = (t: string, v: Record<string, unknown>) => {
    if (!tabelasDosPassos.has(t)) return;
    postos = { ...postos, ...v };
    for (const [col, x] of Object.entries(v)) {
      // As formas vazias (NULL, texto vazio, zero, 1899-12-30) ficam com a classe delas, nunca `entrada`.
      if (x === null || x === undefined || x === '' || x === 0) continue;
      // 1899-12-30 00:00 é a sentinela; com hora, é a hora do TDateTime do Delphi (M18: a duração da cirurgia).
      if (
        x instanceof Date &&
        x.getFullYear() === 1899 &&
        x.getHours() === 0 &&
        x.getMinutes() === 0 &&
        x.getSeconds() === 0
      )
        continue;
      (todos[col] ??= new Set()).add(chaveValor(x));
    }
  };
  let entrada: unknown = null;
  const base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'> = {
    operacao: nome,
    cenario,
    tabelas: op.receita.passos.map((p) => p.tabela),
  };
  let operador: string | undefined;
  /** M20: valores da preparação que os gatilhos copiam para as linhas do cenário (entradas do cenário). */
  let entradasExtras: () => Record<string, unknown> = () => ({});
  const executar = (e: Escritor, ent: unknown) =>
    c.executor.executar(op, c.hospital, ent, contexto(c, cenario, operador), {
      escritor: escritorAnotado(e, anotar),
    });
  let cen: CenarioCaptura;
  if (nome === 'cadastro.cadastrarPaciente') {
    cen = {
      ...base,
      async preparar(e) {
        operador = await operadorSintetico(c, e);
        const cpf = await cpfLivre(e, Date.now() % 90_000_000);
        const cep = cenario === 'sem-cep' ? await cepInexistente(e) : await cepCompleto(e, tiposLogradouro());
        entrada = pacienteSintetico(
          cenario === 'com-cep' ? 'com-cep' : cenario === 'com-responsavel' ? 'com-responsavel' : 'minimo',
          cpf,
          cep,
        );
        // Recusa: o CPF já está cadastrado (pelo próprio executor, antes do retrato).
        if (cenario === 'recusa-cpf-existente') await executar(e, entrada);
      },
      async executar(e) {
        if (cenario === 'recusa-cpf-existente') await exigirRecusa(executar(e, entrada), 'cpf-existente');
        else if (cenario === 'sem-cep') await exigirRecusa(executar(e, entrada), 'cep-inexistente');
        else await executar(e, entrada);
      },
    };
  } else if (nome === 'cadastro.alterarPaciente') {
    // M11: paciente sintético incluído pelo executor (cenário mínimo, operador A) na preparação; a alteração é
    // de outro operador (B), como no dia a dia (ID_TBUSERS muda; USUARIO fica o de quem cadastrou).
    let fora: unknown = null;
    let preparado = 0;
    cen = {
      ...base,
      chavesDaPreparacao: () => ({ RICADPAC: preparado > 0 ? [String(preparado)] : [] }),
      async preparar(e) {
        const quemCadastra = await operadorSintetico(c, e);
        const cpf = await cpfLivre(e, Date.now() % 90_000_000);
        const cep = await cepCompleto(e, tiposLogradouro());
        const pac = await c.executor.executar(
          operacao('cadastro.cadastrarPaciente'),
          c.hospital,
          pacienteSintetico('minimo', cpf, cep),
          contexto(c, 'paciente', quemCadastra),
          { escritor: e },
        );
        const idPaciente = Number(pac.resultado['idPaciente']);
        preparado = idPaciente;
        operador = await operadorSintetico(c, e);
        const lido = await lerPaciente(e, idPaciente);
        if (!lido) throw new Error('Paciente sintético não relido.');
        const versao = lido.versao;
        const alteracoes: Record<string, unknown> =
          cenario === 'telefone'
            ? { celular: '21900000002' }
            : cenario === 'precheckin'
              ? { celular: '21900000003', email: 'precheckin.sintetico@portal.test' }
              : cenario === 'endereco-cep'
                ? {
                    cep: await outroCepCompleto(e, tiposLogradouro(), cep),
                    numero: 200,
                    complemento: 'BLOCO 2',
                  }
                : cenario === 'nome'
                  ? { nome: `${NOME_ACENTUADO} CORRIGIDO` }
                  : cenario === 'adt'
                    ? { nomeMae: `MAE ${MARCA_SINTETICA} CORRIGIDA` }
                    : { cep: await cepInexistente(e) };
        entrada = { idPaciente, versao, alteracoes };
        if (cenario === 'recusas') {
          // Alteração "por fora" (outro operador, pelo executor) depois da leitura, ainda na preparação (antes
          // do retrato "antes"): a versão lida fica velha. A recusa do CEP usa a versão nova (relida).
          await c.executor.executar(
            operacao('cadastro.alterarPaciente'),
            c.hospital,
            { idPaciente, versao, alteracoes: { complemento: 'POR FORA' } },
            contexto(c, 'fora', quemCadastra),
            { escritor: e },
          );
          const relido = await lerPaciente(e, idPaciente);
          if (!relido) throw new Error('Paciente sintético não relido.');
          entrada = { idPaciente, versao: relido.versao, alteracoes };
          fora = { idPaciente, versao, alteracoes: { numero: 7 } };
        }
      },
      async executar(e) {
        if (cenario !== 'recusas') {
          await executar(e, entrada);
          return;
        }
        // 1) CEP inexistente: recusa antes de gravar. 2) Versão velha (linha alterada por fora): 409.
        await exigirRecusa(executar(e, entrada), 'cep-inexistente');
        await exigirRecusa(executar(e, fora), 'conflito-versao');
      },
    };
  } else if (nome === 'cadastro.unificarPaciente') {
    // M57.2: pacientes SINTÉTICOS incluídos pelo executor na preparação (cenário mínimo). O que fica é o segundo; o
    // absorvido, o primeiro. Na recusa, o "que fica" já foi absorvido por um terceiro na preparação (inativo): o banco
    // proíbe apontar a unificação para prontuário inativo (e_ricadpac1) e o novo recusa antes de gravar.
    const preparados: number[] = [];
    cen = {
      ...base,
      chavesDaPreparacao: () => ({ RICADPAC: preparados.map(String) }),
      async preparar(e) {
        const quemCadastra = await operadorSintetico(c, e);
        const cep = await cepCompleto(e, tiposLogradouro());
        const n = cenario === 'recusa-cadastro-inativo' ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const cpf = await cpfLivre(e, (Date.now() + i * 7_919) % 90_000_000);
          const pac = await c.executor.executar(
            operacao('cadastro.cadastrarPaciente'),
            c.hospital,
            pacienteSintetico('minimo', cpf, cep),
            contexto(c, `paciente-${i}`, quemCadastra),
            { escritor: e },
          );
          preparados.push(Number(pac.resultado['idPaciente']));
        }
        operador = await operadorSintetico(c, e);
        const [a, f, terceiro] = preparados as [number, number, number?];
        if (cenario === 'recusa-cadastro-inativo' && terceiro) {
          await c.executor.executar(
            operacao('cadastro.unificarPaciente'),
            c.hospital,
            { idAbsorvido: f, idSobrevivente: terceiro },
            contexto(c, 'antes', operador),
            { escritor: e },
          );
        }
        entrada = { idAbsorvido: a, idSobrevivente: f };
      },
      async executar(e) {
        if (cenario === 'recusa-cadastro-inativo') {
          await exigirRecusa(executar(e, entrada), 'cadastro-inativo');
          return;
        }
        await executar(e, entrada);
      },
    };
  } else if (nome === 'acesso.criarUsuarioIntegracao') {
    cen = {
      ...base,
      async preparar(e) {
        const login = await loginLivre(e, Date.now() % 1_000_000_000);
        entrada = usuarioSintetico(
          cenario === 'variante-nomec' ? 'variante-nomec' : 'usuario-tecnico',
          login,
        );
        if (cenario === 'recusa-nome-existente') await executar(e, entrada);
      },
      async executar(e) {
        if (cenario === 'recusa-nome-existente') await exigirRecusa(executar(e, entrada), 'nome-existente');
        else await executar(e, entrada);
      },
    };
  } else if (nome === 'auditoria.registrarEventoLegado') {
    // Usuário sintético (criado pelo executor) com papel ativo; o evento sai como o Delphi grava.
    const eventos: Record<string, readonly { tipo: number; criticidade: number; opcao: number }[]> = {
      'login-ok': [{ tipo: 6, criticidade: 7, opcao: 5416 }],
      'login-falho': [{ tipo: 7, criticidade: 4, opcao: 5416 }],
      'fim-sessao': [{ tipo: 10, criticidade: 7, opcao: 5417 }],
      'bloqueio-sessao': [
        { tipo: 8, criticidade: 7, opcao: 5143 },
        { tipo: 9, criticidade: 7, opcao: 5144 },
      ],
      'consulta-res': [{ tipo: 1, criticidade: 7, opcao: 5146 }],
      'recusa-tipo': [{ tipo: 11, criticidade: 7, opcao: 5416 }],
    };
    let extra: Record<string, unknown> = {};
    cen = {
      ...base,
      async preparar(e) {
        operador = await operadorSintetico(c, e);
        await papelSintetico(e, operador);
        if (cenario === 'consulta-res') {
          // Paciente sintético (pelo executor) e um atendimento existente (só o ID; FK de TBCABTRILHA).
          const cpf = await cpfLivre(e, Date.now() % 90_000_000);
          const cep = await cepCompleto(e, tiposLogradouro());
          const pac = await c.executor.executar(
            operacao('cadastro.cadastrarPaciente'),
            c.hospital,
            pacienteSintetico('minimo', cpf, cep),
            contexto(c, 'paciente', operador),
            { escritor: e },
          );
          extra = {
            atendimento: await atendimentoExistente(e),
            alvos: [{ tabelaCampo: 'RICADPAC.ID', id: Number(pac.resultado['idPaciente']) }],
          };
        }
      },
      async executar(e) {
        for (const ev of eventos[cenario] ?? []) {
          const ent = { ...ev, estacao: ESTACAO_SINTETICA, ...extra };
          if (cenario === 'recusa-tipo') await exigirRecusa(executar(e, ent), 'entrada-invalida');
          else await executar(e, ent);
        }
      },
    };
  } else if (nome === 'convenio.alterarSituacao') {
    // M12: convênio real da cópia (só o código em memória), alterado na transação desfeita.
    cen = {
      ...base,
      async preparar(e) {
        if (cenario === 'recusa-dth') {
          const c = await convenioComDiariaInvalida(e);
          entrada = {
            convenio: c.codigo,
            operacao: c.situacao === 'A' ? 'suspender' : 'reativar',
            justificativa: `${MARCA_M12}: recusa da diária`,
          };
          return;
        }
        const cod = await convenioNaSituacao(e, cenario === 'suspender' ? 'A' : 'I');
        entrada = { convenio: cod, operacao: cenario, justificativa: `${MARCA_M12}: reprodução` };
      },
      async executar(e) {
        if (cenario === 'recusa-dth')
          await exigirRecusa(executar(e, entrada), 'diaria-acompanhante-invalida');
        else await executar(e, entrada);
      },
    };
  } else if (nome === 'convenio.alterarContrato') {
    cen = {
      ...base,
      async preparar(e) {
        const c = await contratoAtivo(e);
        const just = `${MARCA_M12}: reprodução`;
        if (cenario === 'nome' || cenario === 'recusa-colisao')
          entrada = {
            convenio: c.codigo,
            aba: 'cadastro',
            valores: { nome: `${MARCA_M12} ${c.codigo}` },
            lidos: { nome: cenario === 'recusa-colisao' ? `${c.nome} (lido antes)` : c.nome },
            justificativa: just,
          };
        else if (cenario === 'elegibilidade')
          entrada = {
            convenio: c.codigo,
            aba: 'faturabilidade',
            valores: {
              validaCarteira: c.validaCarteira === 'T' ? 'F' : 'T',
              retornoDias: c.retornoDias === 30 ? '15' : '30',
            },
            lidos: { validaCarteira: c.validaCarteira, retornoDias: String(c.retornoDias) },
            justificativa: just,
          };
        else
          entrada = {
            convenio: c.codigo,
            aba: 'financeiro',
            valores: { prazoPagamentoDias: c.prazoPagamentoDias === 30 ? 45 : 30 },
            lidos: { prazoPagamentoDias: c.prazoPagamentoDias },
            justificativa: just,
          };
      },
      async executar(e) {
        if (cenario === 'recusa-colisao') await exigirRecusa(executar(e, entrada), 'conflito-versao');
        else await executar(e, entrada);
      },
    };
  } else if (nome === 'preco.reajustar') {
    // Tabelas: 305 (modelo VALOR), 617 (com percentual em TBPERTHM), 10 (compartilhada), 306 (por arquivo) e
    // 53 (modelo CH, recusa). Itens reais da cópia (só códigos e valores em memória), transação desfeita.
    const plano: Record<string, { tab: number; n: number; modo: 'percentual' | 'arquivo'; ch?: boolean }> = {
      'percentual-valor': { tab: 305, n: 3, modo: 'percentual' },
      'com-perthm': { tab: 617, n: 2, modo: 'percentual' },
      'tabela-compartilhada': { tab: 10, n: 2, modo: 'percentual' },
      'por-arquivo': { tab: 306, n: 3, modo: 'arquivo' },
      'recusa-amb': { tab: 53, n: 1, modo: 'percentual', ch: true },
    };
    cen = {
      ...base,
      async preparar(e) {
        const p = plano[cenario];
        if (!p) throw new Error(`Cenário sem plano: ${cenario}.`);
        const hoje = await hojeDoBanco(e);
        const itens = p.ch ? await itensModeloCh(e, p.tab, p.n) : await itensDaTabela(e, p.tab, p.n);
        entrada = entradaReajuste(p.tab, hoje, itens, p.modo, {
          tabelaCompartilhada: cenario === 'tabela-compartilhada',
          percentualTabela: cenario === 'com-perthm',
        });
      },
      async executar(e) {
        if (cenario === 'recusa-amb') await exigirRecusa(executar(e, entrada), 'modelo-ch');
        else await executar(e, entrada);
      },
    };
  } else if (nome === 'preco.desfazerReajuste') {
    // O lote nasce pelo executor (preco.reajustar) na transação da captura, antes do retrato "antes".
    cen = {
      ...base,
      async preparar(e) {
        const hoje = await hojeDoBanco(e);
        const itens = await itensDaTabela(e, 307, 3);
        const r = entradaReajuste(307, hoje, itens, 'percentual');
        await c.executor.executar(
          operacao('preco.reajustar'),
          c.hospital,
          r,
          contexto(c, `${cenario}-prep`),
          {
            escritor: e,
          },
        );
        if (cenario === 'recusa-alterado') {
          const primeiro = r.itens[0];
          if (primeiro) await mexerPorFora(e, 307, primeiro.codigo, hoje);
        }
        entrada = {
          tabela: 307,
          data: hoje,
          lote: r.lote,
          parte: 1,
          partes: 1,
          justificativa: `${MARCA_M12}: desfazer na reprodução`,
          itens: r.itens.map((i) => ({ codigo: i.codigo, valores: i.novos })),
        };
      },
      async executar(e) {
        if (cenario === 'recusa-alterado') await exigirRecusa(executar(e, entrada), 'alterado-por-fora');
        else await executar(e, entrada);
      },
    };
  } else if (OPERACOES_REPRODUCAO_PERMISSOES.has(nome)) {
    // ADR 0022: permissões do próprio legado; o operador sintético opera a preparação e o cenário.
    cen = cenarioDePermissao(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_M59.has(nome)) {
    // M59-F2: a retirada da senha antiga (usuário sintético com a senha antiga e a credencial forte; contingência).
    cen = cenarioM59(
      nome,
      cenario,
      base,
      c,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_M59_F3.has(nome)) {
    // M59-F3: senhas secundárias e segredos de parceiros (valores sintéticos; o registro do cofre do Sante).
    cen = cenarioM59F3(
      nome,
      cenario,
      base,
      c,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_M10.has(nome)) {
    // M10: usuários, escopos, termo, acomodações e leitos; o operador sintético opera a preparação e o cenário.
    cen = cenarioM10(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_CATALOGOS.has(nome)) {
    // M13: um lote da carga do catálogo, com o importador ligado e a carga aprovada criados na preparação.
    cen = cenarioDeCatalogo(nome, cenario, base, c, executar, exigirRecusa, async (e) => {
      operador = await operadorSintetico(c, e);
    });
  } else if (OPERACOES_REPRODUCAO_PEP.has(nome)) {
    // M22: registro clínico de um profissional da cópia (login e CBO só em memória), respostas sintéticas.
    cen = cenarioPep(
      nome,
      cenario,
      base,
      c.hospital,
      executar,
      (e, n, ent, quem) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, quem), {
          escritor: e,
        }),
      (login) => (operador = login),
    );
  } else if (OPERACOES_REPRODUCAO_AGENDA.has(nome)) {
    // M17: agenda de consultas; paciente, grade, marcações e encaixes de partida pelo executor na preparação.
    cen = cenarioAgenda(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
      tiposLogradouro,
    );
  } else if (OPERACOES_REPRODUCAO_PEP_M23.has(nome)) {
    // M23: alergias, documentos, sumário, anexo, exame externo e pedido de exame de um profissional da cópia.
    cen = cenarioPepM23(
      nome,
      cenario,
      base,
      c.hospital,
      executar,
      (e, n, ent, quem) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, quem), {
          escritor: e,
        }),
      (login) => (operador = login),
    );
  } else if (OPERACOES_REPRODUCAO_PRESCRICAO.has(nome)) {
    // M24: prescrição de um profissional da cópia (login e CBO só em memória), itens do cadastro da cópia.
    cen = cenarioPrescricao(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent, quem) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, quem), {
          escritor: e,
        }),
      (login) => (operador = login),
    );
  } else if (OPERACOES_REPRODUCAO_RECEPCAO.has(nome)) {
    // M19: recepção; operador sintético, guichê, senhas, chamadas e suspensões de partida pelo executor.
    cen = cenarioRecepcao(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_EXAME.has(nome) || OPERACOES_REPRODUCAO_CIRURGIA.has(nome)) {
    // M18: agenda de exames e centro cirúrgico; paciente, grade, marcações, sala e cirurgias de partida pelo executor.
    const fabrica = OPERACOES_REPRODUCAO_EXAME.has(nome) ? cenarioExame : cenarioCirurgia;
    cen = fabrica(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      // W0-10: `fixo` troca o operador da sessão por um login dado (o usuário do portal).
      async (e, fixo?: string) => (operador = await operadorSintetico(c, e, fixo)),
      tiposLogradouro,
    );
  } else if (OPERACOES_REPRODUCAO_ATENDIMENTO.has(nome)) {
    // M20: atendimento externo; operador, paciente, senha e a ficha de partida pelo executor na preparação.
    const atd = cenarioAtendimento(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
      tiposLogradouro,
    );
    cen = atd;
    entradasExtras = () => atd.entradasDaPreparacao();
  } else if (OPERACOES_REPRODUCAO_SADT.has(nome)) {
    // M26: SADT — o estado de partida pelo próprio executor (pedido do prontuário, lançamento, resultado, liberação,
    // atendimento de requisição); profissionais, atendimentos e exames da cópia (só IDs e o login, em memória).
    const sadt = cenarioSadt(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent, quem) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, quem ?? operador), {
          escritor: e,
        }),
      (login) => (operador = login),
      (e) => operadorSintetico(c, e),
      tiposLogradouro,
    );
    cen = sadt;
    entradasExtras = () => sadt.entradasDaPreparacao();
  } else if (OPERACOES_REPRODUCAO_INTERNACAO.has(nome)) {
    // M21: internação, leitos, higienização e SAME; operador, paciente e a internação de partida pelo executor.
    const int = cenarioInternacao(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
      tiposLogradouro,
    );
    cen = int;
    entradasExtras = () => int.entradasDaPreparacao();
  } else if (OPERACOES_REPRODUCAO_ENFERMAGEM.has(nome)) {
    // M25: a prescrição de partida pelo executor (médico da cópia) e a checagem pela enfermagem da cópia (login e CBO
    // só em memória).
    cen = cenarioEnfermagem(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent, quem) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, quem), {
          escritor: e,
        }),
      (login) => (operador = login),
    );
  } else if (OPERACOES_REPRODUCAO_W108.has(nome)) {
    // W1-08: aprazamento (enfermeiro) e estorno da checagem; a prescrição e a checagem de partida pelo executor.
    cen = cenarioW108(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent, quem) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, quem), {
          escritor: e,
        }),
      (login) => (operador = login),
    );
  } else if (OPERACOES_REPRODUCAO_DICIONARIO.has(nome)) {
    // M27: dicionário pessoal; o operador sintético é o dono; a palavra de partida pelo próprio executor.
    cen = cenarioDicionario(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_SUPRIMENTOS.has(nome)) {
    // M28: estoque e compras; operador sintético com o usuário do estoque, documentos e pedidos de partida pelo executor.
    const sup = cenarioSuprimentos(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
    cen = sup;
    entradasExtras = () => sup.entradasDaPreparacao();
  } else if (OPERACOES_REPRODUCAO_FARMACIA.has(nome)) {
    // M29: a entrega ao setor; o operador sintético é quem recebe; o documento dispensado é o da cópia.
    cen = cenarioFarmacia(
      nome,
      cenario,
      base,
      executar,
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_TISS.has(nome)) {
    // M31: o pós-fechamento; as contas, os lotes e os itens da cópia (só IDs); o operador sintético monta o lote,
    // registra o protocolo, baixa, recorre, registra o desfecho e fecha a competência.
    cen = cenarioTiss(
      nome,
      cenario,
      base,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_FINANCEIRO.has(nome)) {
    // M32: o financeiro; credores, contas bancárias e contas do faturamento da cópia (só IDs); o título de partida e a
    // aprovação na alçada sintética pelo próprio executor e em SGH_ na transação desfeita.
    cen = cenarioFinanceiro(
      nome,
      cenario,
      base,
      c.hospital,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_REPASSE.has(nome)) {
    // M33: o repasse; o médico e o evento de um lançamento recente da cópia (só IDs); a apuração aprovada e o lançamento
    // de partida do estorno pelo executor e em SGH_ na transação desfeita.
    cen = cenarioRepasse(
      nome,
      cenario,
      base,
      c.hospital,
      executar,
      (e, n, ent) =>
        c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`, operador), {
          escritor: e,
        }),
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_REPRODUCAO_FATURAMENTO.has(nome)) {
    // M30: conta do paciente; as contas e os itens da cópia (só IDs); o operador sintético fecha, reabre e confere.
    cen = cenarioFaturamento(
      nome,
      cenario,
      base,
      c.hospital,
      executar,
      async (e) => (operador = await operadorSintetico(c, e)),
    );
  } else if (OPERACOES_DOMINIOS.some((o) => o.receita.nome === nome)) {
    cen = cenarioDeDominio(nome, cenario, base, c, executar, (e, n, ent) =>
      c.executor.executar(operacao(n), c.hospital, ent, contexto(c, `${cenario}-prep`), { escritor: e }),
    );
  } else {
    throw new Error(`Operação ${nome} sem reprodução.`);
  }
  return {
    cenario: cen,
    entradas() {
      if (op.receita.modo === 'carga') {
        const r: Record<string, unknown> = Object.fromEntries(
          Object.entries(todos).filter(([col]) => classes[col]?.classe === 'entrada'),
        );
        for (const [col, bruto] of Object.entries(entradasExtras()))
          for (const v of Array.isArray(bruto) ? bruto : [bruto])
            if (v !== null && v !== undefined && v !== '')
              r[col] = new Set([...((r[col] as Set<string> | undefined) ?? []), chaveValor(v)]);
        return r;
      }
      // Só as colunas que a receita classifica como `entrada` (o que a tela digitou e a sessão).
      return Object.fromEntries(
        Object.entries(postos).filter(
          ([col, v]) =>
            classes[col]?.classe === 'entrada' &&
            v !== null &&
            v !== '' &&
            v !== 0 &&
            // 1899-12-30 00:00 é a sentinela; com hora, é a hora do TDateTime do Delphi (M08: CHTPLIMPEZA).
            !(
              v instanceof Date &&
              v.getFullYear() === 1899 &&
              v.getHours() === 0 &&
              v.getMinutes() === 0 &&
              v.getSeconds() === 0
            ),
        ),
      );
    },
  };
}
