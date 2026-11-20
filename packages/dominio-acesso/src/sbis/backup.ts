// M59-F5 (ficha do M59, seção 7, "Backup verificado"; cap-13 §13.6.3; SBIS-13): a situação dos relatórios de
// restauração do estabelecimento. A diária (cópia de leitura restaurada do backup da noite) está em dia quando a
// última com sucesso e integridade conferida tem até 26 horas; a mensal (restauração completa em ambiente isolado),
// até 32 dias. Restauração com sucesso mas sem a verificação de integridade não conta.
import {
  PRAZO_RESTAURACAO_DIARIA_HORAS,
  PRAZO_RESTAURACAO_MENSAL_DIAS,
  type Restauracao,
  type SituacaoRestauracao,
  type TipoRestauracao,
} from '@sgh/contratos';

const HORA = 3_600_000;
const PRAZO_MS: Readonly<Record<TipoRestauracao, number>> = {
  diaria: PRAZO_RESTAURACAO_DIARIA_HORAS * HORA,
  mensal: PRAZO_RESTAURACAO_MENSAL_DIAS * 24 * HORA,
};

export type RestauracaoRegra = Pick<Restauracao, 'tipo' | 'fim' | 'resultado' | 'integridade'>;

export const restauracaoValida = (r: RestauracaoRegra) => r.resultado === 'ok' && r.integridade === 'ok';

export function situacaoRestauracao(
  tipo: TipoRestauracao,
  lista: readonly RestauracaoRegra[],
  agora: Date,
): SituacaoRestauracao {
  const doTipo = lista.filter((r) => r.tipo === tipo);
  const validas = doTipo.filter(restauracaoValida).map((r) => Date.parse(r.fim));
  const ultima = validas.length ? Math.max(...validas) : null;
  const janela = agora.getTime() - PRAZO_MS[tipo];
  return {
    tipo,
    ultimaComSucesso: ultima === null ? null : new Date(ultima).toISOString(),
    emDia: ultima !== null && ultima >= janela && ultima <= agora.getTime() + HORA,
    falhasRecentes: doTipo.filter((r) => !restauracaoValida(r) && Date.parse(r.fim) >= janela).length,
  };
}

export function situacaoBackup(lista: readonly RestauracaoRegra[], agora: Date) {
  const diaria = situacaoRestauracao('diaria', lista, agora);
  const mensal = situacaoRestauracao('mensal', lista, agora);
  const alertas: string[] = [];
  if (!diaria.emDia)
    alertas.push(`Sem restauração diária conferida nas últimas ${PRAZO_RESTAURACAO_DIARIA_HORAS} horas.`);
  if (!mensal.emDia)
    alertas.push(`Sem restauração completa conferida nos últimos ${PRAZO_RESTAURACAO_MENSAL_DIAS} dias.`);
  if (diaria.falhasRecentes + mensal.falhasRecentes > 0)
    alertas.push('Há restauração com falha ou sem a verificação de integridade no período.');
  return { diaria, mensal, alertas };
}
