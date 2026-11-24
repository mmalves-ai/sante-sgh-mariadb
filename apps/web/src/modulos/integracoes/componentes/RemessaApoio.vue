<script setup lang="ts">
// Remessa ao laboratório de apoio, etiquetas e de-para (F3.5, 05-SADT linha 14). Desenho próprio: escolhido o
// laboratório, a tela mostra as amostras coletadas que ainda não saíram e abre a remessa com todas num clique; o item
// sem código no apoio aparece marcado e segura o fechamento (retira-se o item ou completa-se o de-para); fechar, enviar
// com o protocolo e cancelar com o motivo ficam na mesma linha da remessa; as etiquetas saem só com identificadores.
// O de-para de analito e de material se desativa e reativa aqui (nunca se apaga). Cada ação respeita a permissão do cargo.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  abrirRemessaApoio,
  agirRemessaApoio,
  type DeParaApoio,
  lerDeParaApoio,
  lerEtiquetasApoio,
  lerPendentesApoio,
  lerRemessaApoio,
  lerRemessasApoio,
  retirarItemRemessaApoio,
  salvarDeParaAnalitoApoio,
  salvarDeParaMaterialApoio,
} from '../api-apoio-remessa.js';

const props = defineProps<{ laboratorios: readonly { codigo: number; nome: string | null }[] }>();
const cliente = useQueryClient();
const podeRemessa = pode('sadt.apoio.remessa');
const podeConfigurar = pode('sadt.apoio.configurar');
const lab = ref<number | null>(props.laboratorios[0]?.codigo ?? null);
const opcoesLab = computed(() =>
  props.laboratorios.map((l) => ({ valor: l.codigo, rotulo: l.nome ?? String(l.codigo) })),
);
const pendentes = useQuery({
  queryKey: computed(() => ['sadt', 'apoio', 'pendentes', lab.value]),
  queryFn: () => lerPendentesApoio(lab.value!),
  enabled: computed(() => lab.value !== null),
});
const remessas = useQuery({
  queryKey: computed(() => ['sadt', 'apoio', 'remessas', lab.value]),
  queryFn: () => lerRemessasApoio(lab.value!),
  enabled: computed(() => lab.value !== null),
});
const aberta = ref<number | null>(null);
const remessa = useQuery({
  queryKey: computed(() => ['sadt', 'apoio', 'remessa', aberta.value]),
  queryFn: () => lerRemessaApoio(aberta.value!),
  enabled: computed(() => aberta.value !== null),
});
const dePara = useQuery({
  queryKey: computed(() => ['sadt', 'apoio', 'de-para', lab.value]),
  queryFn: () => lerDeParaApoio(lab.value!),
  enabled: computed(() => lab.value !== null),
});
const etiquetas = ref<{ item: number; codigo: string; linhas: string[] }[]>([]);
const meio = ref<'portal' | 'manual' | 'integracao'>('portal');
const opcoesMeio = [
  { valor: 'portal' as const, rotulo: 'Portal do apoio' },
  { valor: 'manual' as const, rotulo: 'Manual (malote)' },
  { valor: 'integracao' as const, rotulo: 'Integração' },
];
const protocolo = ref('');
const motivo = ref('');
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const semDePara = computed(() => (pendentes.data.value ?? []).filter((p) => !p.codigoExameApoio).length);

async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['sadt', 'apoio'] });
}
async function fazer(fn: () => Promise<unknown>, mensagem: string): Promise<void> {
  erro.value = null;
  feito.value = null;
  try {
    await fn();
    feito.value = mensagem;
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
const abrir = () =>
  fazer(async () => {
    const r = await abrirRemessaApoio(lab.value!);
    aberta.value = r.id;
    etiquetas.value = [];
  }, 'Remessa aberta com as amostras pendentes.');
const agir = (acao: 'fechar' | 'reabrir' | 'enviar' | 'cancelar') =>
  fazer(
    () =>
      agirRemessaApoio(aberta.value!, {
        acao,
        meio: meio.value,
        protocolo: protocolo.value.trim() || null,
        motivo: motivo.value.trim() || null,
      }),
    `Remessa: ${acao} feito.`,
  );
const retirar = (item: number) =>
  fazer(() => retirarItemRemessaApoio(aberta.value!, item), 'Item retirado da remessa (fica cancelado).');
const imprimir = () =>
  fazer(async () => {
    etiquetas.value = await lerEtiquetasApoio(aberta.value!);
  }, 'Etiquetas do apoio prontas.');
const alternarAnalito = (d: DeParaApoio['analitos'][number]) =>
  fazer(
    () =>
      salvarDeParaAnalitoApoio({
        id: d.id,
        laboratorio: lab.value,
        exame: d.exame,
        analito: d.analito,
        codigoExameApoio: d.codigoExameApoio,
        codigoAnalitoApoio: d.codigoAnalitoApoio,
        nomeApoio: d.nomeApoio,
        fatorConversao: d.fatorConversao,
        ativo: !d.ativo,
      }),
    d.ativo ? 'De-para desativado.' : 'De-para reativado.',
  );
const alternarMaterial = (d: DeParaApoio['materiais'][number]) =>
  fazer(
    () =>
      salvarDeParaMaterialApoio({
        id: d.id,
        laboratorio: lab.value,
        material: d.material,
        codigoApoio: d.codigoApoio,
        nomeApoio: d.nomeApoio,
        ativo: !d.ativo,
      }),
    d.ativo ? 'De-para desativado.' : 'De-para reativado.',
  );
/** Textos da tela (pt-BR). */
const T = {
  s1: 'Laboratório de apoio',
  s2: 'Abrir remessa com as pendentes',
  s3: 'Abrir',
  s4: 'Retirar',
  s5: 'Fechar',
  s6: 'Meio de envio',
  s7: 'Protocolo do apoio',
  s8: 'Enviar',
  s9: 'Reabrir',
  s10: 'Etiquetas do apoio',
  s11: 'Motivo do cancelamento',
  s12: 'Cancelar remessa',
  s13: 'Remessa ao laboratório de apoio',
  s14: 'amostra(s) coletada(s) aguardando envio',
  s15: 'sem código no apoio',
  s16: 'Remessas',
  s17: 'Número',
  s18: 'Situação',
  s19: 'Amostras',
  s20: 'Protocolo',
  s21: 'Ação',
  s22: 'Remessa',
  s23: 'Itens da remessa',
  s24: 'Seq.',
  s25: 'Amostra',
  s26: 'Exame',
  s27: 'Código no apoio',
  s28: 'De-para de analito e de material',
  s29: 'Analitos',
  s30: 'Exame / analito',
  s31: 'Fator',
  s32: 'Ativo',
  s33: 'Materiais',
  s34: 'Material',
} as const;
</script>

<template>
  <section aria-labelledby="remessa-apoio-titulo" data-testid="remessa-apoio">
    <h2 id="remessa-apoio-titulo">{{ T.s13 }}</h2>
    <SanteSelecao v-model="lab" :rotulo="T.s1" :opcoes="opcoesLab" data-testid="remessa-apoio-lab" />
    <p v-if="feito" role="status" data-testid="remessa-apoio-feito">{{ feito }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-if="lab !== null">
      <p data-testid="remessa-apoio-pendentes">
        {{ pendentes.data.value?.length ?? 0 }} {{ T.s14 }}
        <span v-if="semDePara" class="secundario">· {{ semDePara }} {{ T.s15 }}</span>
      </p>
      <SanteBotao
        v-if="podeRemessa"
        :rotulo="T.s2"
        :desabilitado="!pendentes.data.value?.length"
        data-testid="remessa-apoio-abrir"
        @acionar="abrir"
      />
      <table class="tabela">
        <caption>
          {{
            T.s16
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T.s17 }}</th>
            <th scope="col">{{ T.s18 }}</th>
            <th scope="col">{{ T.s19 }}</th>
            <th scope="col">{{ T.s20 }}</th>
            <th scope="col">
              <span class="secundario">{{ T.s21 }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in remessas.data.value ?? []" :key="r.id">
            <td>{{ r.numero }}</td>
            <td>{{ r.situacao }}</td>
            <td>{{ r.quantidadeAmostras }}</td>
            <td>{{ r.protocolo ?? '—' }}</td>
            <td><SanteBotao variante="texto" :rotulo="T.s3" @acionar="aberta = r.id" /></td>
          </tr>
        </tbody>
      </table>
      <article v-if="remessa.data.value" class="painel" data-testid="remessa-apoio-detalhe">
        <h3>{{ T.s22 }} {{ remessa.data.value.numero }} · {{ remessa.data.value.situacao }}</h3>
        <div v-if="remessa.data.value.semDePara" role="alert">
          <SanteAlerta
            variante="aviso"
            :texto="`${remessa.data.value.semDePara} exame(s) sem código no apoio: retire o item ou complete o de-para antes de fechar.`"
          />
        </div>
        <table class="tabela">
          <caption>
            {{
              T.s23
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ T.s24 }}</th>
              <th scope="col">{{ T.s25 }}</th>
              <th scope="col">{{ T.s26 }}</th>
              <th scope="col">{{ T.s27 }}</th>
              <th scope="col">{{ T.s18 }}</th>
              <th scope="col">
                <span class="secundario">{{ T.s21 }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in remessa.data.value.itens" :key="i.id">
              <td>{{ i.sequencia }}</td>
              <td>{{ i.codigoBarras }}</td>
              <td>{{ i.exameNome }}</td>
              <td>
                {{ i.codigoExameApoio ?? '—'
                }}{{ i.codigoMaterialApoio ? ` / ${i.codigoMaterialApoio}` : '' }}
              </td>
              <td>{{ i.situacao }}</td>
              <td>
                <SanteBotao
                  v-if="podeRemessa && remessa.data.value.situacao === 'aberta' && i.situacao !== 'cancelado'"
                  variante="texto"
                  :rotulo="T.s4"
                  @acionar="retirar(i.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <template v-if="podeRemessa">
          <SanteBotao
            v-if="remessa.data.value.situacao === 'aberta'"
            :rotulo="T.s5"
            data-testid="remessa-apoio-fechar"
            @acionar="agir('fechar')"
          />
          <template v-if="remessa.data.value.situacao === 'fechada'">
            <SanteSelecao v-model="meio" :rotulo="T.s6" :opcoes="opcoesMeio" />
            <SanteCampoTexto v-model="protocolo" :rotulo="T.s7" :max-bytes="60" />
            <SanteBotao :rotulo="T.s8" data-testid="remessa-apoio-enviar" @acionar="agir('enviar')" />
            <SanteBotao variante="texto" :rotulo="T.s9" @acionar="agir('reabrir')" />
          </template>
          <SanteBotao variante="secundario" :rotulo="T.s10" @acionar="imprimir" />
          <form
            v-if="['aberta', 'fechada'].includes(remessa.data.value.situacao)"
            class="formulario"
            @submit.prevent="agir('cancelar')"
          >
            <SanteCampoTexto v-model="motivo" :rotulo="T.s11" :max-bytes="500" />
            <SanteBotao tipo="submit" variante="texto" :rotulo="T.s12" />
          </form>
        </template>
        <ul v-if="etiquetas.length" data-testid="remessa-apoio-etiquetas">
          <li v-for="e in etiquetas" :key="e.item">
            <strong>{{ e.codigo }}</strong> · {{ e.linhas.join(' · ') }}
          </li>
        </ul>
      </article>
      <h3>{{ T.s28 }}</h3>
      <table class="tabela">
        <caption>
          {{
            T.s29
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T.s30 }}</th>
            <th scope="col">{{ T.s27 }}</th>
            <th scope="col">{{ T.s31 }}</th>
            <th scope="col">{{ T.s32 }}</th>
            <th scope="col">
              <span class="secundario">{{ T.s21 }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in dePara.data.value?.analitos ?? []" :key="d.id">
            <td>{{ d.exameNome }} / {{ d.analitoNome }}</td>
            <td>{{ d.codigoExameApoio }} / {{ d.codigoAnalitoApoio }}</td>
            <td>{{ d.fatorConversao }}</td>
            <td>{{ d.ativo ? 'sim' : 'não' }}</td>
            <td>
              <SanteBotao
                v-if="podeConfigurar"
                variante="texto"
                :rotulo="d.ativo ? 'Desativar' : 'Reativar'"
                @acionar="alternarAnalito(d)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <table class="tabela">
        <caption>
          {{
            T.s33
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T.s34 }}</th>
            <th scope="col">{{ T.s27 }}</th>
            <th scope="col">{{ T.s32 }}</th>
            <th scope="col">
              <span class="secundario">{{ T.s21 }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in dePara.data.value?.materiais ?? []" :key="d.id">
            <td>{{ d.materialNome }}</td>
            <td>{{ d.codigoApoio }}</td>
            <td>{{ d.ativo ? 'sim' : 'não' }}</td>
            <td>
              <SanteBotao
                v-if="podeConfigurar"
                variante="texto"
                :rotulo="d.ativo ? 'Desativar' : 'Reativar'"
                @acionar="alternarMaterial(d)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
