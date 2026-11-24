<script setup lang="ts">
// W0-09: o comunicado por inteiro para quem publica (destinatários com a leitura e a ciência, eventos com o valor
// anterior e o motivo) e o ciclo de vida dele, sempre com motivo: corrigir o texto enquanto ninguém leu (lido ou com
// ciência, o servidor recusa com 409: corrigir é encerrar e publicar outro), encurtar a vigência (nunca estende) e
// encerrar (o comunicado e as ciências continuam visíveis). Não há exclusão física: o "E" é o encerramento.
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraDe } from '../../recepcao/formato.js';
import {
  corrigirComunicado,
  encerrarComunicado,
  encurtarVigenciaComunicado,
  lerComunicado,
  novaChave,
} from '../api-inicio.js';
import { anteriorDoEvento, motivoValido } from '../regras-tela.js';
import ErroTrabalho from './ErroTrabalho.vue';

const props = defineProps<{ id: number }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const detalhe = useQuery({
  queryKey: computed(() => ['mensagens', 'comunicado', props.id]),
  queryFn: () => lerComunicado(props.id),
});

type Acao = 'corrigir' | 'vigencia' | 'encerrar';
const acao = ref<Acao | null>(null);
const assunto = ref('');
const texto = ref('');
const fim = ref('');
const motivo = ref('');
const erroMotivo = ref(false);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const ocupado = ref(false);
let chave: string | null = null;

function iniciar(a: Acao): void {
  const d = detalhe.data.value;
  acao.value = a;
  motivo.value = '';
  erroMotivo.value = false;
  erro.value = null;
  feito.value = null;
  chave = null;
  if (d) {
    assunto.value = d.assunto;
    texto.value = d.texto;
    fim.value = d.vigenciaFim.slice(0, 16);
  }
}
watch(
  () => props.id,
  () => {
    acao.value = null;
    feito.value = null;
  },
);

async function confirmar(): Promise<void> {
  if (!acao.value) return;
  if (!motivoValido(motivo.value)) {
    erroMotivo.value = true;
    return;
  }
  erroMotivo.value = false;
  erro.value = null;
  ocupado.value = true;
  chave ??= novaChave(`comunicado-${acao.value}`);
  try {
    const m = motivo.value.trim();
    if (acao.value === 'corrigir')
      await corrigirComunicado(props.id, { assunto: assunto.value, texto: texto.value, motivo: m }, chave);
    else if (acao.value === 'vigencia')
      await encurtarVigenciaComunicado(props.id, { vigenciaFim: fim.value, motivo: m }, chave);
    else await encerrarComunicado(props.id, { motivo: m }, chave);
    feito.value = t(`trabalho.mensagens.gestao.feito.${acao.value}`);
    acao.value = null;
    chave = null;
    await cliente.invalidateQueries({ queryKey: ['mensagens'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <article class="painel" data-testid="comunicado-gestao" aria-labelledby="com-gestao-titulo">
    <ErroTrabalho v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!detalhe.data.value" role="status">{{ t('trabalho.carregando') }}</p>
    <template v-else>
      <h2 id="com-gestao-titulo">{{ detalhe.data.value.assunto }}</h2>
      <p class="secundario">
        {{ t('trabalho.mensagens.gestao.publicado', { em: dataHoraDe(detalhe.data.value.publicadoEm) }) }} ·
        {{
          t('trabalho.mensagens.gestao.vigencia', {
            de: dataHoraDe(detalhe.data.value.vigenciaInicio),
            ate: dataHoraDe(detalhe.data.value.vigenciaFim),
          })
        }}
      </p>
      <div v-if="detalhe.data.value.encerradoEm" data-testid="comunicado-encerrado">
        <SanteAlerta
          variante="info"
          :texto="
            t('trabalho.mensagens.gestao.encerradoEm', {
              em: dataHoraDe(detalhe.data.value.encerradoEm),
              por: detalhe.data.value.encerradoPor ?? '—',
              motivo: detalhe.data.value.motivoEncerramento ?? '—',
            })
          "
        />
      </div>
      <p class="texto" data-testid="comunicado-texto">{{ detalhe.data.value.texto }}</p>
      <p v-if="feito" role="status" data-testid="comunicado-feito">{{ feito }}</p>
      <ErroTrabalho v-if="erro" :erro="erro" />

      <div v-if="!detalhe.data.value.encerradoEm && acao === null" class="acoes">
        <SanteBotao
          v-if="detalhe.data.value.podeCorrigir"
          variante="secundario"
          :rotulo="t('trabalho.mensagens.gestao.corrigir')"
          data-testid="comunicado-corrigir"
          @acionar="iniciar('corrigir')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('trabalho.mensagens.gestao.encurtar')"
          data-testid="comunicado-encurtar"
          @acionar="iniciar('vigencia')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('trabalho.mensagens.gestao.encerrar')"
          data-testid="comunicado-encerrar"
          @acionar="iniciar('encerrar')"
        />
      </div>
      <p
        v-if="!detalhe.data.value.encerradoEm && !detalhe.data.value.podeCorrigir && acao === null"
        class="secundario"
        data-testid="comunicado-nao-corrige"
      >
        {{ t('trabalho.mensagens.gestao.naoCorrige') }}
      </p>

      <form
        v-if="acao"
        class="painel formulario"
        novalidate
        data-testid="comunicado-form"
        @submit.prevent="confirmar"
      >
        <h3>{{ t(`trabalho.mensagens.gestao.titulo.${acao}`) }}</h3>
        <template v-if="acao === 'corrigir'">
          <SanteCampoTexto
            v-model="assunto"
            :rotulo="t('trabalho.mensagens.assunto')"
            :max-bytes="120"
            obrigatorio
            data-testid="comunicado-assunto"
          />
          <SanteCampoTexto
            v-model="texto"
            :rotulo="t('trabalho.mensagens.texto2')"
            :max-bytes="2000"
            multilinha
            obrigatorio
            data-testid="comunicado-novo-texto"
          />
        </template>
        <div v-if="acao === 'vigencia'" class="campo">
          <label for="com-novo-fim">{{ t('trabalho.mensagens.gestao.novoFim') }}</label>
          <input id="com-novo-fim" v-model="fim" type="datetime-local" data-testid="comunicado-novo-fim" />
          <p class="secundario">{{ t('trabalho.mensagens.gestao.soEncurta') }}</p>
        </div>
        <p v-if="acao === 'encerrar'" class="secundario">{{ t('trabalho.mensagens.gestao.encerrarDica') }}</p>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('trabalho.mensagens.gestao.motivo')"
          :max-bytes="200"
          obrigatorio
          data-testid="comunicado-motivo"
        />
        <p v-if="erroMotivo" class="erro" data-testid="erro-motivo">
          {{ t('trabalho.mensagens.gestao.motivoCurto') }}
        </p>
        <div class="acoes">
          <SanteBotao
            v-if="acao === 'encerrar'"
            variante="destrutivo"
            :confirmacao="t('trabalho.mensagens.gestao.encerrarPergunta')"
            :rotulo="t('trabalho.mensagens.gestao.confirmar')"
            :desabilitado="ocupado"
            data-testid="comunicado-confirmar"
            @acionar="confirmar"
          />
          <SanteBotao
            v-else
            tipo="submit"
            :rotulo="t('trabalho.mensagens.gestao.confirmar')"
            :desabilitado="ocupado"
            data-testid="comunicado-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('trabalho.mensagens.gestao.desistir')"
            data-testid="comunicado-desistir"
            @acionar="acao = null"
          />
        </div>
      </form>

      <h3>{{ t('trabalho.mensagens.gestao.destinatarios') }}</h3>
      <table class="tabela" data-testid="comunicado-destinatarios">
        <caption class="sgh-visualmente-oculto">
          {{
            t('trabalho.mensagens.gestao.destinatarios')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('trabalho.mensagens.gestao.login') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.via') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.gestao.lidaEm') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.gestao.cienciaEm') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in detalhe.data.value.destinatarios" :key="d.login">
            <td>{{ d.login }}</td>
            <td>{{ d.via }}</td>
            <td>{{ d.lidaEm ? dataHoraDe(d.lidaEm) : '—' }}</td>
            <td>
              {{ detalhe.data.value.cienciaObrigatoria ? (d.cienciaEm ? dataHoraDe(d.cienciaEm) : '—') : '' }}
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="detalhe.data.value.eventos.length > 0">
        <h3>{{ t('trabalho.mensagens.gestao.historico') }}</h3>
        <ul class="eventos" data-testid="comunicado-eventos">
          <li v-for="(ev, i) in detalhe.data.value.eventos" :key="i">
            <strong>{{ t(`trabalho.mensagens.gestao.evento.${ev.evento}`) }}</strong>
            · {{ dataHoraDe(ev.em) }} · {{ ev.por }} · {{ ev.motivo }}
            <span v-if="ev.antes" class="secundario">
              ({{ t('trabalho.mensagens.gestao.antes') }}
              {{ ev.evento === 'vigencia' ? dataHoraDe(ev.antes) : anteriorDoEvento(ev.antes) }})</span
            >
          </li>
        </ul>
      </template>

      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('trabalho.fechar')"
          data-testid="comunicado-fechar"
          @acionar="emit('fechar')"
        />
      </div>
    </template>
  </article>
</template>

<style scoped>
.texto {
  white-space: pre-wrap;
}
.eventos {
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
.erro {
  color: var(--sgh-alerta);
  font-weight: 600;
  margin: 0;
}
.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
</style>
