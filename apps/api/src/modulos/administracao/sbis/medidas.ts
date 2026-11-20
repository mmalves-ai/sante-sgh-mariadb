// M59-F5 (ficha do M59, regra 1; cap-13 §13.2.1): a medida de cada concessão da coexistência, a partir do que as
// fatias F1 a F4 já mostram nas telas delas (sem leitura nova do banco). Falha fechada: a fonte que não responde vira
// "indisponível" e não encerra a concessão. Textos de produto, só contagens (abaixo de 5 vira "<5").
import type {
  CodigoConcessao,
  DesviosPrivilegiosResposta,
  ImutabilidadeResposta,
  PainelSaneamento,
  Politica2fa,
  ResumoIdentidade,
  SegredosLegadoResposta,
} from '@sgh/contratos';
import type { MedidaConcessao, SituacaoEstabelecimento } from '@sgh/dominio-acesso';

type Contagem = number | '<5';
const positivo = (c: Contagem) => c === '<5' || c > 0;
const atendido = (medida: string): MedidaConcessao => ({ indicador: 'atendido', medida });
const pendente = (medida: string): MedidaConcessao => ({ indicador: 'pendente', medida });
export const INDISPONIVEL: MedidaConcessao = {
  indicador: 'indisponivel',
  medida: 'Não foi possível medir agora.',
};

export function medidaSenha(r: ResumoIdentidade): MedidaConcessao {
  if (!r.tabelasProntas) return INDISPONIVEL;
  const antigas = (['legado-cifrada', 'legado-sem-salt', 'legado-texto-puro'] as const).map(
    (k) => r.porSenha[k] ?? 0,
  );
  const algum = antigas.some(positivo);
  return algum
    ? pendente(`Ainda há usuários ativos com a senha no formato antigo (${antigas.map(String).join(' / ')}).`)
    : atendido('Nenhum usuário ativo com a senha no formato antigo.');
}

export function medidaPermissoes(p: PainelSaneamento): MedidaConcessao {
  const restantes = p.grupos.filter((g) => g.grupo !== 'MASTER').reduce((s, g) => s + g.ativos, 0);
  if (restantes > 0 || p.administradores.excedido)
    return pendente(
      `Usuários ativos nos grupos de acesso amplo: ${restantes < 5 && restantes > 0 ? '<5' : restantes}; administradores ${p.administradores.ativosNoMaster} de ${p.administradores.maximo}.`,
    );
  return atendido('Grupos de acesso amplo dissolvidos; administradores dentro do configurado.');
}

export function medidaPrivilegio(d: DesviosPrivilegiosResposta): MedidaConcessao {
  if (!d.planoAplicado) return pendente('O privilégio mínimo por módulo ainda não foi aplicado no banco.');
  if (d.excessoTotal + d.faltaTotal > 0)
    return pendente(`Privilégio mínimo com desvio: ${d.excessoTotal} a mais e ${d.faltaTotal} a menos.`);
  return atendido(`Privilégio mínimo aplicado sem desvio (plano ${d.versaoPlano}).`);
}

export function medidaTrilha(s: SituacaoEstabelecimento): MedidaConcessao {
  return s.desligado && !s.contingenciaAtiva
    ? atendido('Só o Sante grava a trilha deste estabelecimento.')
    : pendente(
        'A trilha anterior ainda pode ser gravada fora do Sante (desligamento ou contingência em aberto).',
      );
}

export function medidaProntuario(i: ImutabilidadeResposta): MedidaConcessao {
  return i.concessaoVigente
    ? pendente('Ainda há conta do Sante que apaga registro clínico.')
    : atendido('Nenhuma conta do Sante apaga registro clínico.');
}

export function medidaSegredos(s: SegredosLegadoResposta): MedidaConcessao {
  const com = s.tabelas.filter((t) => positivo(t.comValor)).map((t) => t.rotulo);
  return com.length
    ? pendente(`Ainda há credencial guardada em tabela: ${com.join(', ')}.`)
    : atendido('Nenhuma credencial de parceiro guardada em tabela, fora das exceções registradas.');
}

/** Segundo fator obrigatório para os perfis críticos (onda 1) ou para todos, já em vigor no dia. */
export function segundoFatorCriticos(politicas: readonly Politica2fa[], hoje: string): boolean {
  return politicas.some((p) => p.ativa && (p.onda === 1 || p.alvo === 'todos') && p.inicio <= hoje);
}

/** As fontes de cada medida (as funções das telas das fatias F1 a F4); a ausente vira indisponível. */
export interface FontesMedidas {
  readonly senha?: () => Promise<ResumoIdentidade>;
  readonly permissoes?: () => Promise<PainelSaneamento>;
  readonly privilegio?: () => Promise<DesviosPrivilegiosResposta>;
  readonly prontuario?: () => Promise<ImutabilidadeResposta>;
  readonly segredos?: () => Promise<SegredosLegadoResposta>;
}

export async function medirConcessoes(
  f: FontesMedidas,
  sit: SituacaoEstabelecimento,
): Promise<Partial<Record<CodigoConcessao, MedidaConcessao>>> {
  const medir = async <T>(fonte: (() => Promise<T>) | undefined, m: (x: T) => MedidaConcessao) => {
    if (!fonte) return INDISPONIVEL;
    try {
      return m(await fonte());
    } catch {
      return INDISPONIVEL;
    }
  };
  const [senha, permissoes, privilegio, prontuario, segredos] = await Promise.all([
    medir(f.senha, medidaSenha),
    medir(f.permissoes, medidaPermissoes),
    medir(f.privilegio, medidaPrivilegio),
    medir(f.prontuario, medidaProntuario),
    medir(f.segredos, medidaSegredos),
  ]);
  return {
    'senha-formato-antigo': senha,
    'permissoes-antigas': permissoes,
    'privilegio-banco': privilegio,
    'trilha-alteravel': medidaTrilha(sit),
    'prontuario-alteravel': prontuario,
    'segredos-em-tabela': segredos,
  };
}
