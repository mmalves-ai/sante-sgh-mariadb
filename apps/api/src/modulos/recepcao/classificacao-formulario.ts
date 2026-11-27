// O formulário de classificação do prontuário (modelo E08) gravado pela classificação de risco (M44, etapa 1; ficha,
// seção 5 e regra 7): o prontuário é um só, e o médico que abre o paciente pelo formulário continua vendo a
// classificação ali. A gravação é a do registro clínico do M22 (`pep.registrarEvolucao`, executor do M04), com a
// classificação estruturada e os sinais na MESMA transação (ordem 8 da ficha). Ligado só quando, para a sessão:
//   - o registro clínico está liberado (`pep.evolucao.registro`);
//   - o modelo E08 está no parâmetro dos modelos liberados e fora da lista de modelos ainda não liberados (D-LIB-2 do
//     M22: hoje o E08 está fora, pela conferência abaixo da meta e pelo componente de alergia);
// senão, a classificação grava só neste sistema e a tela avisa (POL-3: completo e desligado, com o motivo visível).
import {
  definicaoParametro,
  MODELO_E08,
  lerModelosForaDaLiberacao,
  modeloForaDaLiberacao,
  PARAMETRO_MODELOS_FORA_DA_LIBERACAO,
  PARAMETRO_MODELOS_LIBERADOS,
  type ModelosForaDaLiberacao,
  type ValorParametro,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { camposParaRegistro } from '@sgh/dominio-pep';
import { mapaDoModeloE08, respostasE08 } from '@sgh/dominio-recepcao';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, type SessaoCadastro } from '../cadastro/comum.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import type { Liberacao, ServicoRegistro } from '../pep/public-api.js';
import type { PortaClassificacao } from './classificacao-porta.js';
import type { FormularioClassificacao } from './classificacao-servico.js';

const TOLERANCIA = 'pep.evolucao.toleranciaRetroativoMinutos';

export interface DependenciasFormulario {
  readonly registro: ServicoRegistro;
  readonly configuracao: FonteConfiguracao | null;
  /** A liberação do registro clínico para a sessão (`pep.evolucao.registro`). */
  liberacaoRegistro(s: SessaoCadastro): Promise<Liberacao>;
  readonly porta: PortaClassificacao;
}

async function parametros(
  s: SessaoCadastro,
  configuracao: FonteConfiguracao | null,
): Promise<{ liberados: Set<string>; fora: ModelosForaDaLiberacao; toleranciaMin: number }> {
  let valores: ValorParametro[] = [];
  try {
    valores = configuracao ? await configuracao.valoresParametro(s.rede, s.hospital) : [];
  } catch {
    valores = [];
  }
  const setor = s.req.sgh?.sessao.unidadeAtiva;
  const sujeito = {
    rede: s.rede,
    empresa: null,
    estabelecimento: s.hospital,
    unidade: setor === null || setor === undefined ? null : String(setor),
    perfis: [],
    usuario: s.login,
  };
  const ler = (chave: string) => {
    const def = definicaoParametro(chave);
    return def ? valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor) : null;
  };
  const tol = ler(TOLERANCIA);
  return {
    liberados: new Set(
      String(ler(PARAMETRO_MODELOS_LIBERADOS) ?? '')
        .split(',')
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    ),
    fora: lerModelosForaDaLiberacao(ler(PARAMETRO_MODELOS_FORA_DA_LIBERACAO)),
    toleranciaMin: typeof tol === 'number' && Number.isFinite(tol) ? tol : 15,
  };
}

/** O formulário de classificação para a sessão (ligado ou desligado com o motivo). */
export function formularioDaSessao(s: SessaoCadastro, d: DependenciasFormulario): FormularioClassificacao {
  return {
    async estado() {
      const p = await parametros(s, d.configuracao);
      const fora = modeloForaDaLiberacao(MODELO_E08, p.fora);
      if (fora) return { ligado: false, motivo: `${fora} A classificação fica só neste sistema.` };
      const l = await d.liberacaoRegistro(s);
      if (!l.ligada) return { ligado: false, motivo: l.motivo };
      if (!p.liberados.has(MODELO_E08))
        return {
          ligado: false,
          motivo:
            'O formulário de classificação do prontuário não está entre os modelos liberados: a classificação fica só neste sistema.',
        };
      return { ligado: true, motivo: null };
    },
    async gravar(x) {
      const p = await parametros(s, d.configuracao);
      const modelo = (await d.registro.modelos(s.porta)).find(
        (m) => m.codigo?.trim().toUpperCase() === MODELO_E08,
      );
      const conv = modelo ? await d.registro.representacao(s.porta, modelo.id) : null;
      if (!modelo || !conv)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Formulário de classificação do prontuário não encontrado',
        );
      const { mapa, faltam } = mapaDoModeloE08(camposParaRegistro(conv.representacao));
      const vistas = await d.porta.opcoesPrioridadeVistas(s.porta);
      const indices = new Set(vistas.map((v) => v.indice).filter((i): i is number => i !== null));
      const r = respostasE08(
        {
          cor: x.cor,
          cores: x.conteudo.cores,
          sinais: x.sinais,
          queixa: x.queixa,
          observacoes: x.observacoes,
          alergia: x.alergia,
          comorbidades: x.comorbidades as never,
        },
        mapa,
        indices,
        faltam,
      );
      if (r.situacao !== 'respostas')
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Formulário do prontuário diferente',
          `O formulário de classificação deste estabelecimento não tem as perguntas esperadas (${r.faltam.join(', ')}): a classificação não foi gravada.`,
          { codigo: 'modelo-diferente' },
        );
      const { agora } = await d.porta.relogio(s.porta);
      const prof = await d.registro.profissional(s.porta, s.login);
      const m = await d.registro.montarEvolucao(
        s.porta,
        {
          paciente: x.paciente,
          modelo: modelo.id,
          atendimento: Number(x.cabecalho),
          dataHoraClinica: agora.slice(0, 16),
          impressao: conv.representacao.impressaoLayout,
          respostas: r.respostas,
        },
        prof,
        {
          liberados: p.liberados,
          fora: p.fora,
          toleranciaMin: p.toleranciaMin,
          paciente: { idade: null, sexo: null },
        },
      );
      const g = await d.registro.registrar(
        s.porta,
        {
          ...m.gravacao,
          classificacao: {
            cabecalho: x.cabecalho,
            reg: x.reg,
            ...x.classificacao,
            sinais: x.sinais,
            comPrioridade: r.comPrioridade,
          },
        },
        contextoOperacao(s, 'classificacao'),
      );
      return { registro: g.registro, comPrioridade: r.comPrioridade };
    },
  };
}
