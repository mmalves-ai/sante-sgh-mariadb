<script setup lang="ts">
// Registrar ou editar uma oportunidade de serviço compartilhado da Rede (M57, etapa 3; regra 11): área, título,
// descrição e os estabelecimentos envolvidos (da rede). O registro novo vai ao banco do estabelecimento da sessão; a
// edição (com `registro`) mostra o detalhe (quem registrou, onde e quando; a última alteração) e manda à API SÓ os
// campos que mudaram, no banco em que o registro mora, com a trilha.
import {
  AREAS_SERVICO_COMPARTILHADO,
  type AlterarServicoCompartilhado,
  type AreaServicoCompartilhado,
  esquemaAlterarServicoCompartilhado,
  esquemaNovoServicoCompartilhado,
  type ServicoCompartilhado,
  SITUACOES_SERVICO_COMPARTILHADO,
  type SituacaoServicoCompartilhado,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { carimboBr } from '../../cadastro/formato.js';
import { alterarServicoRede, registrarServicoRede } from '../api-bi-rede.js';

const props = withDefaults(
  defineProps<{
    estabelecimentos: readonly { codigo: string; nome: string }[];
    /** O registro a editar (sem ele, o formulário registra um novo). */
    registro?: ServicoCompartilhado | null;
  }>(),
  { registro: null },
);
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ registrado: []; alterado: [mudou: boolean] }>();
const { t } = useI18n();

const area = ref<AreaServicoCompartilhado>('compras');
const titulo = ref('');
const descricao = ref('');
const envolvidos = ref<string[]>([]);
const situacao = ref<SituacaoServicoCompartilhado>('registrada');
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const editando = computed(() => props.registro !== null);
const nomes = computed(() => Object.fromEntries(props.estabelecimentos.map((e) => [e.codigo, e.nome])));
watch(visivel, (v) => {
  if (!v) return;
  const r = props.registro;
  area.value = r?.area ?? 'compras';
  titulo.value = r?.titulo ?? '';
  descricao.value = r?.descricao ?? '';
  envolvidos.value = r ? [...r.estabelecimentos] : props.estabelecimentos.map((e) => e.codigo);
  situacao.value = r?.situacao ?? 'registrada';
  erro.value = null;
  aviso.value = null;
});
const opcoesArea = computed(() =>
  AREAS_SERVICO_COMPARTILHADO.map((v) => ({ valor: v, rotulo: t(`biRede.servicos.areas.${v}`) })),
);
const opcoesSituacao = computed(() =>
  SITUACOES_SERVICO_COMPARTILHADO.map((v) => ({ valor: v, rotulo: t(`biRede.servicos.situacoes.${v}`) })),
);
// Os envolvidos que não estão mais na lista da rede (estabelecimento desligado) continuam no registro.
const opcoesEnvolvidos = computed(() => {
  const r = [...props.estabelecimentos];
  for (const c of props.registro?.estabelecimentos ?? [])
    if (!r.some((e) => e.codigo === c)) r.push({ codigo: c, nome: c });
  return r;
});

/** Só os campos que mudaram em relação ao registro (a API ignora os iguais; aqui nem vão). */
function mudancas(r: ServicoCompartilhado): AlterarServicoCompartilhado {
  const m: AlterarServicoCompartilhado = {};
  if (area.value !== r.area) m.area = area.value;
  if (titulo.value.trim() !== r.titulo) m.titulo = titulo.value;
  if (descricao.value.trim() !== (r.descricao ?? '')) m.descricao = descricao.value;
  const ordem = (xs: readonly string[]) => [...xs].sort().join(',');
  if (ordem(envolvidos.value) !== ordem(r.estabelecimentos)) m.estabelecimentos = [...envolvidos.value];
  if (situacao.value !== r.situacao) m.situacao = situacao.value;
  return m;
}

async function alterar(r: ServicoCompartilhado): Promise<void> {
  const m = mudancas(r);
  if (Object.keys(m).length === 0) {
    visivel.value = false;
    emit('alterado', false);
    return;
  }
  const v = esquemaAlterarServicoCompartilhado.safeParse(m);
  if (!v.success) {
    aviso.value =
      envolvidos.value.length === 0
        ? t('biRede.servicos.form.faltaEnvolvido')
        : (v.error.issues[0]?.message ?? '');
    return;
  }
  try {
    const x = await alterarServicoRede(r.estabelecimento, r.id, v.data);
    visivel.value = false;
    emit('alterado', x.mudou);
  } catch (e) {
    erro.value = e;
  }
}

async function gravar(): Promise<void> {
  erro.value = null;
  aviso.value = null;
  if (props.registro) return alterar(props.registro);
  const corpo = {
    area: area.value,
    titulo: titulo.value,
    ...(descricao.value.trim() ? { descricao: descricao.value } : {}),
    estabelecimentos: envolvidos.value,
  };
  const v = esquemaNovoServicoCompartilhado.safeParse(corpo);
  if (!v.success) {
    aviso.value =
      envolvidos.value.length === 0
        ? t('biRede.servicos.form.faltaEnvolvido')
        : (v.error.issues[0]?.message ?? '');
    return;
  }
  try {
    await registrarServicoRede(v.data);
    visivel.value = false;
    emit('registrado');
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="editando ? t('biRede.servicos.form.tituloEdicao') : t('biRede.servicos.form.titulo')"
  >
    <form class="form" data-testid="form-servico-rede" @submit.prevent="gravar">
      <dl v-if="registro" class="detalhe" data-testid="detalhe-servico-rede">
        <dt>{{ t('biRede.servicos.form.registradoEm') }}</dt>
        <dd>
          {{
            t('biRede.servicos.registradoPor', {
              quem: registro.registradoPor,
              quando: carimboBr(registro.registradoEm),
              onde: nomes[registro.estabelecimento] ?? registro.estabelecimento,
            })
          }}
        </dd>
        <template v-if="registro.atualizadoEm">
          <dt>{{ t('biRede.servicos.form.atualizadoEm') }}</dt>
          <dd>
            {{
              t('biRede.servicos.form.atualizadoPor', {
                quem: registro.atualizadoPor ?? '',
                quando: carimboBr(registro.atualizadoEm),
              })
            }}
          </dd>
        </template>
      </dl>
      <SanteSelecao v-model="area" :rotulo="t('biRede.servicos.form.area')" :opcoes="opcoesArea" />
      <SanteCampoTexto
        v-model="titulo"
        :rotulo="t('biRede.servicos.form.nome')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="descricao"
        :rotulo="t('biRede.servicos.form.descricao')"
        :max-bytes="1000"
        multilinha
      />
      <SanteSelecao
        v-if="editando"
        v-model="situacao"
        :rotulo="t('biRede.servicos.form.situacao')"
        :opcoes="opcoesSituacao"
      />
      <fieldset>
        <legend>{{ t('biRede.servicos.form.envolvidos') }}</legend>
        <label v-for="e in opcoesEnvolvidos" :key="e.codigo" class="opcao">
          <input
            v-model="envolvidos"
            type="checkbox"
            :value="e.codigo"
            :data-testid="`envolvido-${e.codigo}`"
          />
          {{ e.nome }}
        </label>
      </fieldset>
      <p v-if="aviso" role="alert" data-testid="aviso-servico-rede">{{ aviso }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="editando ? t('biRede.servicos.form.salvarEdicao') : t('biRede.servicos.form.gravar')"
          tipo="submit"
          data-testid="gravar-servico-rede"
        />
        <SanteBotao
          :rotulo="t('biRede.servicos.form.cancelar')"
          variante="texto"
          @acionar="visivel = false"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
fieldset {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.opcao {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
.detalhe {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
  margin: 0;
  font-size: var(--sgh-fonte-pequena);
}
.detalhe dt {
  font-weight: 600;
}
.detalhe dd {
  margin: 0;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
