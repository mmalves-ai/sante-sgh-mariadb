<script setup lang="ts">
// Solicitação de exames (regra 11): individual ou por kit, com indicação e urgência; os avisos de duplicidade,
// sexo e idade aparecem antes de enviar e pedem confirmação; exame inativo bloqueia.
import type { AvisoPedidoExame, ExameCatalogo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { lerExames, novaChave, solicitarExames } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import SeletorAtendimento from '../../componentes/documentos/SeletorAtendimento.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const termo = ref('');
const procura = ref<string | null>(null);
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'exames', props.paciente, procura.value]),
  queryFn: () => lerExames(props.paciente, procura.value),
});
const atendimento = ref<number | null>(null);
const escolhidos = ref<{ exame: ExameCatalogo; urgente: boolean; indicacao: string }[]>([]);
const kit = ref<number | null>(null);
const opcoesKit = computed<{ valor: number | null; rotulo: string }[]>(() => [
  { valor: null, rotulo: t('pep.doc.exames.semKit') },
  ...(dados.data.value?.kits ?? []).map((k) => ({ valor: k.id, rotulo: k.nome })),
]);
const avisos = ref<AvisoPedidoExame[]>([]);
const confirmar = ref(false);
const chave = ref(novaChave('exames'));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);

function incluir(e: ExameCatalogo): void {
  if (!escolhidos.value.some((x) => x.exame.id === e.id))
    escolhidos.value.push({ exame: e, urgente: false, indicacao: '' });
}
async function enviar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  if (atendimento.value === null) return;
  try {
    const r = await solicitarExames(
      props.paciente,
      {
        atendimento: atendimento.value,
        itens: escolhidos.value.map((x) => ({
          exame: x.exame.id,
          urgente: x.urgente,
          ...(x.indicacao.trim() ? { indicacao: x.indicacao.trim() } : {}),
        })),
        ...(kit.value !== null ? { kit: kit.value } : {}),
        confirmarAvisos: confirmar.value,
      },
      chave.value,
    );
    avisos.value = [...r.avisos];
    if (r.gravado) {
      mensagem.value = t('pep.doc.exames.enviado');
      escolhidos.value = [];
      kit.value = null;
      confirmar.value = false;
      avisos.value = [];
      chave.value = novaChave('exames');
      await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
    }
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="exames-titulo" data-testid="aba-exames-conteudo">
    <h2 id="exames-titulo">{{ t('pep.doc.exames.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tabela-pedidos">
        <caption>
          {{
            t('pep.doc.exames.pedidos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.doc.exames.col.exame') }}</th>
            <th scope="col">{{ t('pep.doc.exames.col.grupo') }}</th>
            <th scope="col">{{ t('pep.doc.exames.col.solicitado') }}</th>
            <th scope="col">{{ t('pep.doc.exames.col.situacao') }}</th>
            <th scope="col">{{ t('pep.doc.exames.col.profissional') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in dados.data.value.pedidos" :key="`${p.pedido}-${p.exame}`">
            <td>
              {{ p.nome }}<span v-if="p.urgente" class="marcador">{{ t('pep.doc.exames.urgente') }}</span>
            </td>
            <td>{{ t(`pep.doc.exames.grupo.${p.grupo}`) }}</td>
            <td>{{ dataHoraBr(p.solicitadoEm) }}</td>
            <td>{{ t(`pep.doc.exames.situacao.${p.situacao}`) }}</td>
            <td>{{ p.profissional ?? '-' }}</td>
          </tr>
        </tbody>
      </table>

      <AvisoConsulta :acao="dados.data.value.criar" />
      <form
        v-if="dados.data.value.criar.pode"
        class="form"
        data-testid="form-pedido"
        @submit.prevent="enviar"
      >
        <h3>{{ t('pep.doc.exames.solicitar') }}</h3>
        <SeletorAtendimento v-model="atendimento" :atendimentos="dados.data.value.atendimentos" so-abertos />
        <div class="linha">
          <label>
            <span>{{ t('pep.doc.exames.procurar') }}</span>
            <input
              v-model="termo"
              type="search"
              data-testid="exame-procura"
              @keydown.enter.prevent="procura = termo.trim() || null"
            />
          </label>
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.doc.exames.procurar')"
            @acionar="procura = termo.trim() || null"
          />
          <SanteSelecao
            v-model="kit"
            class="campo"
            data-testid="exame-kit"
            :rotulo="t('pep.doc.exames.kit')"
            :opcoes="opcoesKit"
          />
        </div>
        <ul class="lista">
          <li v-for="e in dados.data.value.catalogo.slice(0, 30)" :key="e.id">
            <SanteBotao
              variante="texto"
              :rotulo="t('pep.doc.exames.incluir', { nome: e.nome })"
              :data-testid="`incluir-exame-${e.id}`"
              @acionar="incluir(e)"
            />
          </li>
        </ul>
        <h4>{{ t('pep.doc.exames.escolhidos') }}</h4>
        <ul class="lista">
          <li v-for="(x, i) in escolhidos" :key="x.exame.id" class="cartao linha">
            <strong>{{ x.exame.nome }}</strong>
            <label class="marca"
              ><input v-model="x.urgente" type="checkbox" />{{ t('pep.doc.exames.urgente') }}</label
            >
            <label
              ><span>{{ t('pep.doc.exames.indicacao') }}</span
              ><input v-model="x.indicacao" maxlength="200"
            /></label>
            <SanteBotao
              variante="texto"
              :rotulo="t('pep.doc.exames.tirar', { nome: x.exame.nome })"
              @acionar="escolhidos.splice(i, 1)"
            />
          </li>
        </ul>
        <div v-if="avisos.length" class="cartao" data-testid="avisos-pedido">
          <h4>{{ t('pep.doc.exames.avisos') }}</h4>
          <SanteAlerta
            v-for="a in avisos"
            :key="`${a.exame}-${a.tipo}`"
            :variante="a.bloqueia ? 'alerta' : 'aviso'"
            :texto="a.texto"
          />
          <label class="marca"
            ><input v-model="confirmar" type="checkbox" data-testid="confirmar-avisos" />{{
              t('pep.doc.exames.confirmarAvisos')
            }}</label
          >
        </div>
        <SanteBotao
          tipo="submit"
          :rotulo="t('pep.doc.exames.enviar')"
          :desabilitado="escolhidos.length === 0"
          data-testid="enviar-pedido"
        />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
