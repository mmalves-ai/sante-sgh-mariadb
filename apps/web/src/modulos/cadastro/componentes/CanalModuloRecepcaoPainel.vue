<script setup lang="ts">
// Canal de entrada de cada módulo de recepção (F3.1, 02-CAD linha 2). Sem local de atendimento, a abertura do
// atendimento e a admissão tiram o módulo do canal por onde o paciente entra: agenda, urgência, internação, exames ou
// demanda espontânea. Uma linha por módulo, com o combo do canal e gravação na troca (um clique); a tela avisa na hora
// quando o canal já é de outro módulo, e o servidor confere de novo pela regra do domínio (errosDoCanal) e pela chave
// única. Tirar o canal grava "nenhum"; nada se apaga. Ler: config.parametro.ler; gravar: config.parametro.editar.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { CANAIS_ENTRADA, gravarCanalModulo, lerModulosRecepcao } from '../api-ficha-complementar.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Canal de entrada dos módulos de recepção',
      explica:
        'Sem local de atendimento, a regra de campo vale no módulo do canal: na urgência, internação e exames o canal vale sobre o guichê ocupado; na agenda e na demanda, o guichê vem antes.',
      modulo: 'Módulo',
      canal: 'Canal de entrada',
      nenhum: 'Nenhum',
      inativo: 'inativo',
      vazio: 'Nenhum módulo de recepção cadastrado.',
      gravado: 'Canal gravado.',
      ocupado: 'O canal já é do módulo {modulo}: tire o canal dele antes.',
      canais: {
        agenda: 'Agenda (consulta marcada)',
        urgencia: 'Urgência (pronto atendimento)',
        internacao: 'Internação (admissão)',
        exames: 'Exames (SADT)',
        demanda: 'Demanda espontânea',
      },
    },
  },
});

const podeEditar = computed(() => pode('config.parametro.editar'));
const cliente = useQueryClient();
const modulos = useQuery({ queryKey: ['cadastro', 'modulos-recepcao'], queryFn: () => lerModulosRecepcao() });
const opcoes = computed(() => [
  { valor: '', rotulo: t('nenhum') },
  ...CANAIS_ENTRADA.map((valor) => ({ valor, rotulo: t(`canais.${valor}`) })),
]);

const recusa = ref<string | null>(null);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

async function trocar(m: { id: number; versao: number; canal: string | null }, novo: string): Promise<void> {
  if (gravando.value || (m.canal ?? '') === novo) return;
  recusa.value = null;
  aviso.value = null;
  erro.value = null;
  // Validação na hora: um canal tem um módulo só.
  const dono = novo ? modulos.data.value?.itens.find((x) => x.canal === novo && x.id !== m.id) : undefined;
  if (dono) {
    recusa.value = t('ocupado', { modulo: `${dono.codigo} (${dono.descricao})` });
    return;
  }
  gravando.value = true;
  try {
    await gravarCanalModulo(m.id, m.versao, novo || null);
    aviso.value = t('gravado');
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if ((tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') && e instanceof ErroApi && e.problema)
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
  } finally {
    gravando.value = false;
    await cliente.invalidateQueries({ queryKey: ['cadastro', 'modulos-recepcao'] });
  }
}
</script>

<template>
  <section aria-labelledby="canal-modulo-titulo" data-testid="painel-canal-modulo">
    <h2 id="canal-modulo-titulo">{{ t('titulo') }}</h2>
    <p>{{ t('explica') }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" data-testid="recusa-canal" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="aviso-canal" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="modulos.data.value && !modulos.data.value.itens.length">{{ t('vazio') }}</p>
    <table v-else-if="modulos.data.value" data-testid="lista-canal-modulo">
      <thead>
        <tr>
          <th scope="col">{{ t('modulo') }}</th>
          <th scope="col">{{ t('canal') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in modulos.data.value.itens" :key="m.id" :data-testid="`canal-modulo-${m.codigo}`">
          <td>
            {{ m.codigo }} · {{ m.descricao }}<span v-if="!m.ativo"> · {{ t('inativo') }}</span>
          </td>
          <td>
            <SanteSelecao
              :model-value="m.canal ?? ''"
              :rotulo="t('canal')"
              ocultar-rotulo
              :opcoes="opcoes"
              :desabilitado="!podeEditar || gravando || (!m.ativo && !m.canal)"
              :data-testid="`canal-modulo-selecao-${m.codigo}`"
              @update:model-value="(v: string) => trocar(m, v)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
