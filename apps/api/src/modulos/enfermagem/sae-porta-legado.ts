// Porta da etapa 4 do M45 sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; as gravações
// só do novo (SGH_PEP_SAE*, SGH_PEP_PRESC_ENFERMEIRO, SGH_PEP_VACINA_APLICADA e o evento na SGH_OUTBOX) numa transação
// SGH_ com a SGH_TRILHA junto (o escritor só das SGH_: nenhuma tabela do legado). Em dev sobre a cópia compartilhada, as
// gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  atendimentoDaConsulta,
  atendimentosExternosDoDia,
  atividadePorId,
  atividadesVigentes,
  cabecalhoDaReceita,
  carregarTerminologiaSaeSgh,
  checagemCuidadoPorId,
  checagensDosCuidados,
  checarCuidadoSgh,
  consultasDoProfissional,
  corrigirVacinaSgh,
  inativarReceitaEnfermeiroSgh,
  dominiosDaSaeLegado,
  estornarCuidadoSgh,
  evoluirSaeSgh,
  gravarTrilha,
  type NucleoLegado,
  prescreverCuidadoSgh,
  prescreverMedicamentoEnfermeiroSgh,
  receitasDoAtendimento,
  registrarSaeSgh,
  registrarVacinaSgh,
  saeDoAtendimento,
  somenteSgh,
  suspenderCuidadoSgh,
  terminologiaSaeCarregada,
  vacinasDoPaciente,
  recusasRia,
  type Leitor,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoSae, METODOS_PORTA_SAE, type PortaSae } from './sae-porta.js';

export function portaSaeLegado(nucleo: NucleoLegado, opcoes: { sghSoLeitura?: boolean } = {}): PortaSae {
  const ctx = (c: ContextoSae) => ({ rede: c.rede, hospital: c.hospital, traceId: 'sae' });
  const ler = <T>(c: ContextoSae, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pela chave).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) =>
      Promise.reject(new Error(`Operação ${op} sem receita do executor: a etapa grava só no novo.`)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: nada é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          registrarSae: (p) => registrarSaeSgh(e, { hospital: h, ...p }),
          evoluir: (x) => evoluirSaeSgh(e, { hospital: h, ...x }),
          prescrever: (x) => prescreverCuidadoSgh(e, { hospital: h, ...x }),
          suspender: (x) => suspenderCuidadoSgh(e, { hospital: h, ...x }),
          checar: (x) => checarCuidadoSgh(e, { hospital: h, ...x }),
          estornar: (x) => estornarCuidadoSgh(e, { hospital: h, ...x }),
          carregarTerminologia: (t) => carregarTerminologiaSaeSgh(e, { hospital: h, ...t }),
          prescreverMedicamento: (x) => prescreverMedicamentoEnfermeiroSgh(e, { hospital: h, ...x }),
          registrarVacina: (v) => registrarVacinaSgh(e, { hospital: h, rede: c.rede, ...v }),
          inativarReceita: (r) => inativarReceitaEnfermeiroSgh(e, { hospital: h, ...r }),
          corrigirVacina: (v) => corrigirVacinaSgh(e, { hospital: h, rede: c.rede, ...v }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    dominios: (c) => ler(c, (l) => dominiosDaSaeLegado(l)),
    terminologia: (c) => ler(c, (l) => terminologiaSaeCarregada(l, c.hospital)),
    sae: (c, a) => ler(c, (l) => saeDoAtendimento(l, c.hospital, a)),
    atividadesVigentes: (c, as) => ler(c, (l) => atividadesVigentes(l, c.hospital, as)),
    atividade: (c, id) => ler(c, (l) => atividadePorId(l, c.hospital, id)),
    checagens: (c, o) => ler(c, (l) => checagensDosCuidados(l, { hospital: c.hospital, ...o })),
    checagem: (c, id) => ler(c, (l) => checagemCuidadoPorId(l, c.hospital, id)),
    consulta: (c, a) => ler(c, (l) => atendimentoDaConsulta(l, a)),
    consultasDoProfissional: (c, o) => ler(c, (l) => consultasDoProfissional(l, o)),
    externosDoDia: (c, dia) => ler(c, (l) => atendimentosExternosDoDia(l, { dia })),
    cabecalhoReceita: (c, o) => ler(c, (l) => cabecalhoDaReceita(l, o)),
    receitas: (c, a) => ler(c, (l) => receitasDoAtendimento(l, c.hospital, a)),
    vacinas: (c, p) => ler(c, (l) => vacinasDoPaciente(l, c.hospital, p)),
    recusasRia: (c) => ler(c, (l) => recusasRia(l, c.hospital)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSaeIndisponivel(): PortaSae {
  return portaIndisponivel<PortaSae>(METODOS_PORTA_SAE);
}
