// Comuns dos controladores do cadastro (M11): a sessão (rede, estabelecimento, login e o contexto do núcleo por id), a
// permissão pelas mesmas regras CASL da tela (a negação vai à trilha), o contexto do executor (Idempotency-Key) e a
// tradução dos erros do executor e das recusas em Problem Details em português (sem nome de coluna: o aviso de colisão
// cita o campo da ficha).
// Melhoria: o contexto da porta e da gravação é o do @sgh/nucleo (cliente, estabelecimento e usuário por id), e a
// linha da trilha é a trilha_auditoria do cliente, gravada pela porta na mesma transação.
import { EVENTOS_AUDITAVEIS, lerIdBanco } from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoDoEstabelecimento, idUsuarioDaSessao } from './contexto-nucleo.js';
import type { ContextoPorta } from './porta.js';
import { ROTULOS_CAMPOS_PACIENTE } from './servico.js';
import type { ContextoGravacao, RegistroTrilhaTela } from './tipos.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

export interface SessaoCadastro {
  readonly req: RequisicaoAutorizada;
  readonly hospital: string;
  readonly rede: string;
  readonly login: string;
  readonly porta: ContextoPorta;
  pode(codigo: string): boolean;
}

export function sessaoDe(req: RequisicaoAutorizada): SessaoCadastro {
  const a = req.sgh;
  if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
  const hospital = a.sessao.estabelecimentoAtivo;
  if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
  const rede = a.sessao.rede ?? '';
  return {
    req,
    hospital,
    rede,
    login: a.sessao.usuario.login ?? a.sessao.usuario.id,
    porta: {
      ...contextoDoEstabelecimento(hospital),
      usuario: idUsuarioDaSessao(a.sessao.usuario.id),
      correlacao: correlacaoDaRequisicao(req, 'leitura').slice(0, 64),
      rede,
      hospital,
    },
    pode: (codigo) => pode(a.ability, codigo),
  };
}

/** Exige uma permissão a mais que a da rota (mesmas regras CASL); a negação vai à trilha própria. */
export async function exigir(s: SessaoCadastro, codigo: string, trilha: RegistradorTrilha): Promise<void> {
  if (s.pode(codigo)) return;
  await trilha
    .registrar({
      evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req),
      correlacao: correlacaoDaRequisicao(s.req, 'negada'),
      recurso: codigo.slice(0, 80),
      resultado: 'falha',
    })
    .catch(() => undefined);
  throw new ErroProblema(
    'sem-permissao',
    403,
    'Sem permissão',
    'Seu perfil não permite esta ação no cadastro.',
  );
}

export function contextoOperacao(s: SessaoCadastro, rotulo: string): ContextoGravacao {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return {
    cliente: s.porta.cliente,
    estabelecimento: s.porta.estabelecimento,
    usuario: s.porta.usuario,
    correlacao: correlacaoDaRequisicao(s.req, rotulo).slice(0, 64),
    chaveIdempotencia: chave,
    rede: s.rede,
    hospital: s.hospital,
    login: s.login,
    estacao: estacaoDaRequisicao(s.req).slice(0, 80),
  };
}

/**
 * Linha da trilha de uma gravação direta da porta (a porta própria a grava na trilha_auditoria, na mesma transação). O
 * evento e o recurso da tela vão nos dados; nunca nome nem documento.
 */
export function linhaTrilha(
  s: SessaoCadastro,
  evento: string,
  recurso: string,
  operacaoDaTrilha: string,
  alvo: { tabela: string; id?: string | null; paciente?: number | null; chave?: string | null },
): RegistroTrilhaTela {
  const id = alvo.id && /^\d{1,15}$/.test(alvo.id) ? Number(alvo.id) : null;
  return {
    estabelecimento: s.porta.estabelecimento,
    usuario: s.porta.usuario,
    acao: 'operacao',
    entidade: alvo.tabela,
    entidadeId: id,
    dadosDepois: {
      evento,
      recurso,
      operacao: operacaoDaTrilha,
      ...(alvo.chave ? { chave: alvo.chave } : {}),
      ...(alvo.paciente ? { paciente: alvo.paciente } : {}),
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
    },
    correlacao: correlacaoDaRequisicao(s.req, operacaoDaTrilha).slice(0, 64),
  };
}

/** Coluna do modelo (ou campo) → campo da ficha (as portas já citam o campo; a coluna da versão vira "versao"). */
function campoDe(x: string): string {
  return x === 'alterado_em' ? 'versao' : x;
}

/** Erro do executor ou da porta → Problem Details em português (sem nome de tabela nem valor de coluna). */
export function problemaDoCadastro(e: unknown): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (!(e instanceof ErroOperacao)) throw e;
  const p = e.problema;
  const codigo = p.codigo ?? 'erro-interno';
  const rotulo = (campo: string) =>
    ROTULOS_CAMPOS_PACIENTE[campo as keyof typeof ROTULOS_CAMPOS_PACIENTE] ?? campo;
  // Recurso ainda sem modelo ou cadastro básico incompleto no cliente: 501/503 com a mensagem (nada gravado).
  if (p.status === 501 || p.status === 503)
    return new ErroProblema('indisponivel', p.status, p.title, p.detail, { codigo });
  // A recusa por escopo dentro da gravação (ex.: a conta bancária fora do escopo, M32 regra 15) sai como 403.
  if (p.status === 403) return new ErroProblema('sem-permissao', 403, p.title, p.detail, { codigo });
  // O alvo que não existe (ex.: o paciente da abertura do atendimento) sai como 404 com a mensagem, nunca como 500.
  if (p.status === 404) return new ErroProblema('nao-encontrado', 404, p.title, p.detail, { codigo });
  switch (codigo) {
    case 'conflito-versao': {
      const campos = [...new Set((p.colunas ?? []).map(campoDe))];
      return new ErroProblema('conflito-de-versao', 409, p.title, p.detail, {
        alteradoPor: 'desconhecido',
        alteracoes: campos.map((campo) => ({ campo, rotulo: rotulo(campo), lido: null, atual: null })),
        codigo,
      });
    }
    case 'registro-em-edicao':
      return new ErroProblema('registro-em-edicao', 409, p.title, p.detail, { codigo });
    case 'registro-inexistente':
      return new ErroProblema('nao-encontrado', 404, p.title, p.detail, { codigo });
    case 'entrada-invalida':
      return new ErroProblema('entrada-invalida', 400, p.title, p.detail, {
        codigo,
        campos: [...(p.campos ?? [])].map(campoDe),
      });
    case 'operacao-nao-liberada':
    case 'operacao-bloqueada':
      return new ErroProblema('operacao-bloqueada', p.status, p.title, p.detail, { codigo });
    case 'schema-divergente':
      return new ErroProblema('indisponivel', 503, p.title, p.detail, { codigo });
    case 'reautenticacao-necessaria':
      return new ErroProblema('reautenticacao-necessaria', 401, p.title, p.detail, { codigo });
    // W1-04 (regra 4): a recusa por dependentes, como a do CRUD genérico (W0-02): quantos e quais, e a oferta de inativar.
    case 'com-dependentes':
      return new ErroProblema('recusa-de-negocio', 409, p.title, p.detail, {
        codigo,
        dependentes: (p.dependentes ?? []).map((x) => ({
          rotulo: x.rotulo,
          quantidade: x.quantidade,
          amostra: [...x.amostra],
          origem: x.origem,
        })),
        total: (p.dependentes ?? []).reduce((t, x) => t + x.quantidade, 0),
        podeInativar: p.podeInativar === true,
      });
    case 'contexto-invalido':
    case 'idempotencia-divergente':
      return new ErroProblema('entrada-invalida', p.status, p.title, p.detail, { codigo });
    default:
      if (p.status === 409)
        return new ErroProblema('recusa-de-negocio', 409, p.title, p.detail, {
          codigo,
          campos: [...(p.campos ?? [])].map(campoDe),
          // W0-08 (D-CRUD-ORFAOS): a recusa de exclusão leva quantos e quais (rótulo de produto) e a oferta de inativar.
          ...(p.dependentes
            ? { dependentes: p.dependentes.map((x) => ({ ...x, amostra: [...x.amostra] })) }
            : {}),
          ...(p.podeInativar !== undefined ? { podeInativar: p.podeInativar } : {}),
        });
      return new ErroProblema('erro-interno', 500, 'Erro inesperado');
  }
}

/** Inteiro positivo da rota (o mesmo 404 para formato inválido e inexistente: nada vaza). */
export function idDaRota(v: string): number {
  if (lerIdBanco(v) === null) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
  return Number(v);
}

export function pagina(v: string | undefined, max = 1000): number {
  const n = Number(v ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : 1;
}

/** Campo de CSV (separador ;): texto que abriria fórmula na planilha leva apóstrofo; aspas quando precisa. */
export function csv(v: unknown): string {
  let t = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
