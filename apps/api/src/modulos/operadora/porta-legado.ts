// Porta da operadora sobre o núcleo do legado (M56): cada leitura numa transação curta READ ONLY no banco do
// estabelecimento da sessão, pelas leituras de @sgh/legado (catálogos da ANS na F0; SGH_OPE_* e os domínios na F1). As
// gravações da F1 (M56.2) vão numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema) com a SGH_TRILHA na
// mesma transação. Em dev sobre a cópia compartilhada, a gravação é recusada com o motivo (`sghSoLeitura`), como nos
// outros módulos: a prova da gravação é a integração e a assinatura, sob a trava da cópia e desfeitas.
import {
  alterarBeneficiarioSgh,
  baixarBeneficiarioSgh,
  beneficiarioSgh,
  beneficiariosSgh,
  classificacoesAns,
  contagensDeUsoSgh,
  contagensDoContratoSgh,
  contratoSgh,
  contratosSgh,
  dependentesSgh,
  dominiosBeneficiario,
  elegibilidadeSgh,
  emitirViaSgh,
  gravarContratoSgh,
  gravarOperadoraSgh,
  gravarProdutoSgh,
  gravarTrilha,
  gruposSip,
  incluirBeneficiarioSgh,
  type Leitor,
  type NucleoLegado,
  operadoraSgh,
  operadorasSgh,
  pacienteDoHospitalExiste,
  procedimentosSip,
  produtoSgh,
  produtosSgh,
  proximaSequenciaCarteirinha,
  reativarBeneficiarioSgh,
  somenteSgh,
  viasDaCarteirinhaSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoOperadora, METODOS_PORTA_OPERADORA, type PortaOperadora } from './porta.js';

export function portaOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaOperadora {
  const ctx = (c: ContextoOperadora) => ({ rede: c.rede, hospital: c.hospital, traceId: 'operadora' });
  const ler = <T>(c: ContextoOperadora, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    gruposSip: (c) => ler(c, (l) => gruposSip(l)),
    procedimentosSip: (c, f) => ler(c, (l) => procedimentosSip(l, f)),
    classificacoesAns: (c, f) => ler(c, (l) => classificacoesAns(l, f)),
    operadoras: (c) => ler(c, (l) => operadorasSgh(l, c.hospital)),
    operadora: (c, id) => ler(c, (l) => operadoraSgh(l, c.hospital, id)),
    produtos: (c, o) => ler(c, (l) => produtosSgh(l, c.hospital, o)),
    produto: (c, id) => ler(c, (l) => produtoSgh(l, c.hospital, id)),
    contratos: (c, f) => ler(c, (l) => contratosSgh(l, c.hospital, f)),
    contrato: (c, id) => ler(c, (l) => contratoSgh(l, c.hospital, id)),
    beneficiarios: (c, f) => ler(c, (l) => beneficiariosSgh(l, c.hospital, f)),
    beneficiario: (c, id) => ler(c, (l) => beneficiarioSgh(l, c.hospital, id)),
    dependentes: (c, t) => ler(c, (l) => dependentesSgh(l, c.hospital, t)),
    vias: (c, b) => ler(c, (l) => viasDaCarteirinhaSgh(l, c.hospital, b)),
    elegibilidade: (c, n) => ler(c, (l) => elegibilidadeSgh(l, c.hospital, n)),
    contagensDoContrato: (c, x) => ler(c, (l) => contagensDoContratoSgh(l, c.hospital, x)),
    contagensDeUso: (c, x) => ler(c, (l) => contagensDeUsoSgh(l, c.hospital, x)),
    dominiosBeneficiario: (c) => ler(c, (l) => dominiosBeneficiario(l)),
    pacienteExiste: (c, id) => ler(c, (l) => pacienteDoHospitalExiste(l, id)),
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a operadora não grava.',
            { codigo: 'somente-leitura' },
          ),
        );
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          gravarOperadora: (x) => gravarOperadoraSgh(e, { hospital: h, ...x }),
          gravarProduto: (x) => gravarProdutoSgh(e, { hospital: h, ...x }),
          gravarContrato: (x) => gravarContratoSgh(e, { hospital: h, ...x }),
          proximaSequenciaCarteirinha: () => proximaSequenciaCarteirinha(e),
          incluirBeneficiario: (x) => incluirBeneficiarioSgh(e, { hospital: h, ...x }),
          alterarBeneficiario: (x) => alterarBeneficiarioSgh(e, { hospital: h, ...x }),
          baixarBeneficiario: (x) => baixarBeneficiarioSgh(e, { hospital: h, ...x }),
          reativarBeneficiario: (x) => reativarBeneficiarioSgh(e, { hospital: h, ...x }),
          emitirVia: (x) => emitirViaSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaOperadoraIndisponivel(): PortaOperadora {
  return portaIndisponivel<PortaOperadora>(METODOS_PORTA_OPERADORA);
}
